import { Server as HTTPServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'

// Singleton instance
let ioInstance: SocketIOServer | null = null;

export function setupSocketIO(httpServer: HTTPServer): SocketIOServer {
  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:5173',
    'https://lemon-meet.web.app',
    'https://lemon-meet.firebaseapp.com',
    'https://lemon-meet-staging.web.app',
    'https://lemon-meet-staging.firebaseapp.com',
  ]
  
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  })
  
  console.log('[Socket.io] CORS configured for:', allowedOrigins.join(', '))

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`)

    // Join user room (para notificações individuais)
    socket.on('join-user-room', (userId: string) => {
      socket.join(`user:${userId}`)
      console.log(`[Socket.io] Client ${socket.id} joined user room: ${userId}`)
    })

    // Join meeting room
    socket.on('join-meeting', (meetingId: string) => {
      socket.join(`meeting:${meetingId}`)
      console.log(`[Socket.io] Client ${socket.id} joined meeting:${meetingId}`)
    })

    // Leave meeting room
    socket.on('leave-meeting', (meetingId: string) => {
      socket.leave(`meeting:${meetingId}`)
      console.log(`[Socket.io] Client ${socket.id} left meeting:${meetingId}`)
    })

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`)
    })
  })

  ioInstance = io;
  return io
}

// Export singleton instance getter
export function getIO(): SocketIOServer {
  if (!ioInstance) {
    throw new Error('Socket.io not initialized. Call setupSocketIO first.');
  }
  return ioInstance;
}

// Helper function to emit to a specific meeting room
export function emitToMeeting(io: SocketIOServer, meetingId: string, event: string, data: any) {
  io.to(`meeting:${meetingId}`).emit(event, data)
}

// Helper function to emit to a specific user
export function emitToUser(io: SocketIOServer, userId: string, event: string, data: any) {
  io.to(`user:${userId}`).emit(event, data)
  console.log(`[Socket.io] Emitted ${event} to user:${userId}`)
}
