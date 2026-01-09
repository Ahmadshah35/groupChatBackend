// Monitor server performance
const mongoose = require('mongoose');

setInterval(() => {
  if (mongoose.connection.readyState === 1) {
    const stats = mongoose.connection.db.admin().serverStatus();
    console.log(`
📊 Server Stats:
- Connections: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}
- Active Handles: ${process._getActiveHandles().length}
- Active Requests: ${process._getActiveRequests().length}
- Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB
    `);
  }
}, 10000); // Every 10 seconds
