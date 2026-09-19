require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, // Handles '@' automatically without encoding
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

// In server.js right after setting up your pg Pool:
async function initDb() {
  try {
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_mqtt_credentials (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          mqtt_username VARCHAR(100) UNIQUE NOT NULL,
          mqtt_password_hash VARCHAR(255) NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('Database tables verified / created successfully.');
  } catch (err) {
    console.error('Error initializing database tables:', err);
  }
}

initDb();

app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'success',
      message: 'Connected to PostgreSQL on Debian!',
      timestamp: result.rows[0].now,
    });
  } catch (err) {
    console.error('DB Connection Error:', err);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';
// const HIVEMQ_REST_API_TOKEN = process.env.HIVEMQ_REST_API_TOKEN;
// 
// // Helper function to call HiveMQ REST API for mobile app credentials
// async function provisionHiveMQUser(userId, username, password) {
//   if (!HIVEMQ_REST_API_TOKEN) {
//     console.warn('HIVEMQ_REST_API_TOKEN not set. Skipping HiveMQ REST API provisioning.');
//     return true;
//   }
// 
//   const response = await fetch('https://api.hivemq.cloud/v1/roles/permissions', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       'Authorization': `Bearer ${HIVEMQ_REST_API_TOKEN}`,
//     },
//     body: JSON.stringify({
//       username: username,
//       password: password,
//       permissions: [
//         {
//           topic: `users/${userId}/devices/+/commands/#`,
//           permission: 'PUBLISH',
//         },
//         {
//           topic: `users/${userId}/devices/+#`,
//           permission: 'SUBSCRIBE',
//         },
//       ],
//     }),
//   });
// 
//   return response.ok;
// }

// User Signup Endpoint
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Check if user exists
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'User already exists' });
    }

    // 2. Hash Password & Insert User
    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, passwordHash]
    );
    const user = userResult.rows[0];

    // 3. Generate Mobile MQTT Credentials
    // const mqttUsername = `mobile_${user.id.substring(0, 8)}`;
    // const mqttPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
    // const mqttPasswordHash = await bcrypt.hash(mqttPassword, 10);

    // 4. Provision Credentials on HiveMQ Cloud
    // await provisionHiveMQUser(user.id, mqttUsername, mqttPassword);

    // 5. Save MQTT Credentials in DB
    // await client.query(
    //   'INSERT INTO user_mqtt_credentials (user_id, mqtt_username, mqtt_password_hash) VALUES ($1, $2, $3)',
    //   [user.id, mqttUsername, mqttPasswordHash]
    // );

    await client.query('COMMIT');

    // 6. Return Auth Token & MQTT Configuration to App
    // const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      message: 'Signup successful',
      // token,
      user: {
        id: user.id,
        email: user.email,
      },
      // mqttConfig: {
      //   username: mqttUsername,
      //   password: mqttPassword, // Return cleartext password once for app session startup
      //   host: process.env.HIVEMQ_HOST || 'xxxxxx.s1.eu.hivemq.cloud',
      //   port: 8884,
      // },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});