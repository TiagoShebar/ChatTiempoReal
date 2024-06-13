import express from 'express';
import logger from 'morgan';
import dotenv from 'dotenv';
import { Server } from 'socket.io';
import { createServer } from 'http';
import pg from 'pg';
import { DBConfig } from './dbconfig.js';

dotenv.config();

const port = process.env.PORT ?? 3000;

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {}
});

// Configuración del cliente de PostgreSQL
const { Client } = pg;
const DBClient = new Client(DBConfig);

DBClient.connect()
  .then(() => console.log('Connected to PostgreSQL'))
  .catch(err => console.error('Connection error', err.stack));

// Función para ejecutar consultas
const db = {
  execute: async (query, args = []) => {
    try {
      const res = await DBClient.query(query, args);
      return res;
    } catch (e) {
      console.error('DB execution error:', e);
      throw e;
    }
  }
};

// Crear tabla de mensajes si no existe
db.execute(`
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    content TEXT,
    "user" TEXT
  )
`).catch(err => console.error('Error creating table:', err.stack));

// Manejo de conexiones socket.io
io.on('connection', async (socket) => {
  console.log('a user has connected!');

  socket.on('disconnect', () => {
    console.log('a user has disconnected');
  });

  socket.on('chat message', async (msg) => {
    let result;
    const username = socket.handshake.auth.username ?? 'anonymous';
    console.log({ username });
    try {
      result = await db.execute('INSERT INTO messages (content, "user") VALUES ($1, $2) RETURNING id', [msg, username]);
    } catch (e) {
      console.error(e);
      return;
    }

    io.emit('chat message', msg, result.rows[0].id.toString(), username);
  });

  if (!socket.recovered) {
    try {
      const results = await db.execute('SELECT id, content, "user" FROM messages WHERE id > $1', [socket.handshake.auth.serverOffset ?? 0]);

      results.rows.forEach(row => {
        socket.emit('chat message', row.content, row.id.toString(), row.user);
      });
    } catch (e) {
      console.error(e);
    }
  }
});

// Middleware y ruta de inicio
app.use(logger('dev'));

app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/client/index.html');
});

// Iniciar el servidor
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
