const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.io
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(cors());
app.use(express.json());

// Store active rooms and participants
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Join a class room
    socket.on('join-class', ({ classId, userName, userRole, peerId }) => {
        socket.join(classId);

        // Initialize room if it doesn't exist
        if (!rooms.has(classId)) {
            rooms.set(classId, new Map());
        }

        // Add participant to room
        const participant = {
            id: socket.id,
            name: userName,
            role: userRole,
            peerId: peerId,
            isMuted: false,
            isVideoOn: true,
            joinedAt: new Date().toISOString()
        };

        rooms.get(classId).set(socket.id, participant);

        console.log(`${userName} (${socket.id}, peer: ${peerId}) joined class ${classId}`);

        // Send current participants to the new user
        const participants = Array.from(rooms.get(classId).values());
        socket.emit('room-participants', participants);

        // Notify others in the room about the new participant
        socket.to(classId).emit('user-joined', participant);
    });

    // Handle chat messages
    socket.on('send-message', ({ classId, message, sender }) => {
        const chatMessage = {
            id: Date.now(),
            sender,
            text: message,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        // Broadcast to everyone in the room including sender
        io.to(classId).emit('new-message', chatMessage);
    });

    // Handle mic toggle
    socket.on('toggle-mic', ({ classId, isMuted }) => {
        const room = rooms.get(classId);
        if (room && room.has(socket.id)) {
            const participant = room.get(socket.id);
            participant.isMuted = isMuted;

            // Notify others
            socket.to(classId).emit('participant-updated', {
                id: socket.id,
                isMuted
            });
        }
    });

    // Handle video toggle
    socket.on('toggle-video', ({ classId, isVideoOn }) => {
        const room = rooms.get(classId);
        if (room && room.has(socket.id)) {
            const participant = room.get(socket.id);
            participant.isVideoOn = isVideoOn;

            // Notify others
            socket.to(classId).emit('participant-updated', {
                id: socket.id,
                isVideoOn
            });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        // Remove from all rooms
        rooms.forEach((room, classId) => {
            if (room.has(socket.id)) {
                const participant = room.get(socket.id);
                room.delete(socket.id);

                // Notify others in the room
                socket.to(classId).emit('user-left', {
                    id: socket.id,
                    name: participant.name,
                    peerId: participant.peerId
                });

                // Clean up empty rooms
                if (room.size === 0) {
                    rooms.delete(classId);
                }
            }
        });
    });

     // Handle student count (students send every 5s, relay to teacher/others in room)
    socket.on('student-send-count', ({ classId, count, peerId }) => {
        if (classId && peerId != null && typeof count === 'number') {
            socket.to(classId).emit('student-count-update', { peerId, count });
        }
    });

    // Handle leave class
    socket.on('leave-class', ({ classId }) => {
        const room = rooms.get(classId);
        if (room && room.has(socket.id)) {
            const participant = room.get(socket.id);
            room.delete(socket.id);
            socket.leave(classId);

            // Notify others
            socket.to(classId).emit('user-left', {
                id: socket.id,
                name: participant.name,
                peerId: participant.peerId
            });

            console.log(`${participant.name} left class ${classId}`);
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        rooms: rooms.size,
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`🚀 Signaling server running on http://localhost:${PORT}`);
    console.log(`📡 Socket.io ready for connections`);
    console.log(`🎥 PeerJS using cloud service (0.peerjs.com)`);
});
