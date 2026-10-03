// require('dotenv').config();
// const express = require('express');
// const bcrypt = require('bcrypt');
// const jwt = require('jsonwebtoken');
// const { Pool } = require('pg');

import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, Application } from 'express';
import bcrypt from 'bcrypt';
import jwt, { Secret, SignOptions, JwtPayload } from 'jsonwebtoken';
import { Pool, PoolClient, DatabaseError } from 'pg';

const app: Application = express();
app.set('trust proxy', 'loopback'); // Trust the loopback interface for proxy headers
app.use(express.json());

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

export interface DeviceRow {
  id: string;
  user_id: string;
  device_name: string;
  mqtt_topic: string;
  created_at: Date;
}

export interface SetupJwtPayload extends JwtPayload {
  userId: string;
  backendUrl: string;
  deviceId: string;
  mqttTopic: string;
}

interface SignupRequestBody {
  username?: string;
  email?: string;
  password?: string;
}

interface RequestSetupRequestBody {
  userId?: string;
  deviceName?: string;
}

interface VerifySetupRequestBody {
  hardware_id?: string;
}

// Regex Patterns
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Minimum 8 characters, at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

const JWT_SECRET: Secret = process.env.JWT_SECRET || 'default_jwt_secret_change_in_production';

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, // Handles '@' automatically without encoding
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  database: process.env.DB_NAME,
});

// In server.js right after setting up your pg Pool:
async function initDb(): Promise<void> {
  try {
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          username VARCHAR(50) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS devices (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          device_name VARCHAR(100) NOT NULL,
          mqtt_topic VARCHAR(255) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('Database tables verified / created successfully.');
  } catch (err) {
    console.error('Error initializing database tables:', err);
  }
}

initDb();

app.get(
  '/health', 
  async (_req: Request, res: Response): Promise<Response> => {
  try {
    const result = await pool.query<{ now: Date }>('SELECT NOW()');
    return res.json({
      status: 'success',
      message: 'Connected to PostgreSQL on Debian!',
      timestamp: result.rows[0].now,
    });
  } catch (err) {
    console.error('DB Connection Error:', err);
    return res.status(500).json({ error: 'Database connection failed' });
  }
});


// User Signup Endpoint
app.post(
  '/api/auth/signup', 
  async (req: Request<{}, {}, SignupRequestBody>, res: Response): Promise<Response> => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email and password are required' });
  }

  // 2. Validate Email Format
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  // 3. Validate Password Strength
  if (!STRONG_PASSWORD_REGEX.test(password)) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters long and contain an uppercase letter, lowercase letter, number, and special character.'
    });
  }

  const client: PoolClient = await pool.connect();

  try {
    await client.query('BEGIN');

    // 2. Hash Password & Insert User
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await client.query<{ id: string }>(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [username, email.toLowerCase().trim(), passwordHash]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Signup successful',
      user: {
        id: result.rows[0].id,
      },
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK');

    // Catch unique violations (e.g., duplicate username or email)
    if (err instanceof DatabaseError && err.code === '23505') {
      return res.status(400).json({ error: 'Username or email is already registered.' });
    }

    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Step 1: Request JWT Setup Token
app.post(
  '/api/devices/request-setup', 
  async (req: Request<{}, {}, RequestSetupRequestBody>, res: Response): Promise<Response> => {
    const { userId, deviceName } = req.body;

    if (!userId || !deviceName) {
      return res.status(400).json({ error: 'User ID and Device Name are required.' });
    }

    const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host = req.get('host');
    const backendUrl = `${protocol}://${host}/api/devices/verify-setup`;

    try {
      // 1. Create temporary device entry to obtain UUID
      const uuidResult = await pool.query<{ id: string }>('SELECT uuid_generate_v4() AS id');
      const tempDeviceId = uuidResult.rows[0].id;
      const autoMqttTopic = `users/${userId}/devices/${tempDeviceId}`;

      // 2. Insert device into database
      const newDevice = await pool.query<Pick<DeviceRow, 'id' | 'device_name' | 'mqtt_topic'>>(
        `INSERT INTO devices (id, user_id, device_name, mqtt_topic) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id, device_name, mqtt_topic`,
        [tempDeviceId, userId, deviceName.trim(), autoMqttTopic]
      );

      const device = newDevice.rows[0];

      // 3. Create a stateless signed JWT token expiring in 15 minutes
      const signOptions: SignOptions = { expiresIn: '15m' };
      const setupToken = jwt.sign(
        { 
          // userId: userId, 
          // backendUrl: backendUrl,
          userId,
          backendUrl,
          deviceId: device.id, 
          mqttTopic: device.mqtt_topic 
        },
        JWT_SECRET,
        signOptions
      );

      return res.status(201).json({ 
        device,
        setupToken // Returned to mobile app to transmit over BLE
      });
    } catch (err) {
      console.error('Error initiating device setup:', err);
      return res.status(500).json({ error: 'Failed to initiate device setup.' });
    }
  }
);

// Step 2: Edge Device verifies JWT after connecting to Wi-Fi
app.post(
  '/api/devices/verify-setup', 
  async (req: Request<{}, {}, VerifySetupRequestBody>, res: Response): Promise<Response> => {

  // 1. Extract the Authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Unauthorized: Missing or malformed Bearer token.' 
    });
  }

  // 2. Separate "Bearer" from the actual JWT string
  const token = authHeader.split(' ')[1];

  // 3. Extract hardware_id from the JSON request body
  const { hardware_id } = req.body;

  if (!hardware_id) {
    return res.status(400).json({ 
      error: 'Bad Request: Missing hardware_id in request body.' 
    });
  }

  try {
    // Statelessly verify signature & expiration
    const decoded = jwt.verify(token, JWT_SECRET) as SetupJwtPayload;

    // Fetch device record using decoded payload ID
    const result = await pool.query(
      `SELECT id, device_name, mqtt_topic FROM devices WHERE id = $1 AND user_id = $2`,
      [decoded.deviceId, decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Device record not found.' });
    }

    return res.json({ message: 'Device successfully verified!', device: result.rows[0] });
  } catch (err: unknown) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Setup token has expired. Please restart pairing.' });
    }
    console.error('Error verifying setup token:', err);
    return res.status(400).json({ error: 'Invalid setup token.' });
  }
});

// Get all devices owned by a user
app.get(
  '/api/devices/:userId', 
  async (req: Request<{ userId: string }>, res: Response): Promise<Response> => {
    const { userId } = req.params;

    try {
      const result = await pool.query<DeviceRow>(
        `SELECT id, device_name, mqtt_topic, created_at 
         FROM devices 
         WHERE user_id = $1 
         ORDER BY created_at DESC`,
        [userId]
      );

      return res.json({ devices: result.rows });
    } catch (err) {
      console.error('Error fetching devices:', err);
      return res.status(500).json({ error: 'Failed to fetch user devices.' });
    }
  }
);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});