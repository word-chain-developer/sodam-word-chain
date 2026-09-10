const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// 학번(5자리 숫자) + 이름(한글 2~5자) 검증 정규식 (예: 10101홍길동)
const studentIdNameRegex = /^[0-9]{5}[가-힣]{2,5}$/;

// 1. 학생 로그인
app.post('/api/login', (req, res) => {
    const { username } = req.body;
    if (!username || !studentIdNameRegex.test(username)) {
        return res.status(400).json({ 
            success: false, 
            message: '계정 이름은 [학번5자리+이름] 형식이어야 합니다! (예: 10101홍길동)' 
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
        // 힌트 문구 제거됨
        res.status(401).json({ success: false, message: '올바른 관리자 코드가 아닙니다.' });
    }
});

// 3. 실시간 대결 방 및 소켓 관리
let rooms = {};

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
        if (socket.id !== currentPlayer.id) return; // 자기 순서가 아닌 경우

        const cleanWord = word.trim();

        // 첫 단어가 아니면 마지막 글자로 시작하는지 검사항목
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

        // 정상 단어 입력 성공
        room.usedWords.push(cleanWord);
        room.lastWord = cleanWord;
        clearInterval(room.timer);

        // Turn 교체
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
