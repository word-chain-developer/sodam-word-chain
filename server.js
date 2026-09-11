const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// [학번 4자리 + 이름] 정규식 검증
// 1자리(학년: 1~3) + 2자리(반: 1~8) + 3~4자리(번호: 01~30) + 이름(한글 2~5자)
// 올바른 예: 1101홍길동 (1학년 1반 1번), 3830이순신 (3학년 8반 30번)
const studentIdNameRegex = /^[1-3][1-8](0[1-9]|[12][0-9]|30)[가-힣]{2,5}$/;

// 1. 학생 로그인
app.post('/api/login', (req, res) => {
    const { username } = req.body;
    if (!username || !studentIdNameRegex.test(username)) {
        return res.status(400).json({ 
            success: false, 
            message: '올바른 학번+이름 형식이 아닙니다! (4자리 학번: 1~3학년, 1~8반, 01~30번 / 예: 1101홍길동)' 
        });
    }
    res.json({ success: true, username });
});

// 2. 관리자 인증 (sodamms + 이번 달)
app.post('/api/admin-auth', (req, res) => {
    const { code } = req.body;
    const currentMonth = new Date().getMonth() + 1; // 현재 월 (1~12)
    const validCode = `sodamms${currentMonth}`;

    if (code === validCode) {
        res.json({ success: true, message: '관리자 인증 성공!' });
    } else {
        res.status(401).json({ success: false, message: '올바른 관리자 코드가 아닙니다.' });
    }
});

// 3. 실시간 대결 방 및 소켓 관리
let rooms = {};

// 매년 3월 1일 새 학기 학번 갱신 및 방 데이터 자동 초기화 (24시간마다 검사)
setInterval(() => {
    const today = new Date();
    // 3월(month === 2) 1일(date === 1) 자정에 기존 방 데이터 및 대결 기록 리셋
    if (today.getMonth() === 2 && today.getDate() === 1) {
        console.log(`[새 학기 개학] ${today.getFullYear()}년 3월 1일 새 학기가 시작되어 학번 및 게임 방 데이터가 초기화됩니다.`);
        rooms = {};
    }
}, 1000 * 60 * 60 * 24);

io.on('connection', (socket) => {
    socket.on('joinGame', ({ username, roomId, timeLimit }) => {
        socket.join(roomId);
        socket.username = username;
        socket.roomId = roomId;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [],
                currentTurn: 0,
                lastWord: '',
                timer: null,
                timeLimit: parseInt(timeLimit) || 10,
                timeLeft: parseInt(timeLimit) || 10,
                usedWords: []
            };
        }

        const room = rooms[roomId];
        if (room.players.length < 2) {
            room.players.push({ id: socket.id, username });
        }

        io.to(roomId).emit('roomUpdate', {
            players: room.players,
            timeLimit: room.timeLimit
        });

        if (room.players.length === 2 && !room.gameStarted) {
            room.gameStarted = true;
            startTurnTimer(roomId);
            io.to(roomId).emit('gameStart', {
                currentTurnUser: room.players[room.currentTurn].username,
                timeLeft: room.timeLeft
            });
        }
    });

    socket.on('submitWord', ({ word }) => {
        const room = rooms[socket.roomId];
        if (!room || !room.gameStarted) return;

        const currentPlayer = room.players[room.currentTurn];
        if (socket.id !== currentPlayer.id) return;

        const cleanWord = word.trim();

        if (room.lastWord) {
            const lastChar = room.lastWord.slice(-1);
            if (cleanWord[0] !== lastChar) {
                socket.emit('gameError', `'${lastChar}'(으)로 시작하는 단어여야 합니다!`);
                return;
            }
        }

        if (room.usedWords.includes(cleanWord)) {
            socket.emit('gameError', '이미 사용된 단어입니다!');
            return;
        }

        if (cleanWord.length < 2) {
            socket.emit('gameError', '두 글자 이상 입력해주세요!');
            return;
        }

        room.usedWords.push(cleanWord);
        room.lastWord = cleanWord;
        clearInterval(room.timer);

        room.currentTurn = (room.currentTurn + 1) % 2;
        room.timeLeft = room.timeLimit;

        io.to(socket.roomId).emit('wordSuccess', {
            word: cleanWord,
            lastWord: cleanWord,
            nextTurnUser: room.players[room.currentTurn].username,
            timeLeft: room.timeLeft
        });

        startTurnTimer(socket.roomId);
    });

    socket.on('disconnect', () => {
        if (socket.roomId && rooms[socket.roomId]) {
            io.to(socket.roomId).emit('playerLeft', { username: socket.username });
            clearInterval(rooms[socket.roomId].timer);
            delete rooms[socket.roomId];
        }
    });
});

function startTurnTimer(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(roomId).emit('timerTick', { timeLeft: room.timeLeft });

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            const loser = room.players[room.currentTurn].username;
            const winner = room.players[(room.currentTurn + 1) % 2].username;
            io.to(roomId).emit('gameOver', { winner, loser, reason: '시간 초과!' });
            delete rooms[roomId];
        }
    }, 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`소담중학교 끝말잇기 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
