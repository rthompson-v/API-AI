import pg from "pg";
const { Pool } = pg;

// Configuración común de SSL para Supabase
const sslConfig = {
  rejectUnauthorized: false, // Necesario para Supabase desde entornos externos
};

export const pool1 = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: sslConfig,
});

export const pool2 = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME2 || process.env.DB_NAME, // En Supabase suele ser la misma DB pero distinto esquema
  ssl: sslConfig,
});

// En Postgres, usamos .connect() para probar
(async () => {
  try {
    const client = await pool1.connect();
    console.log("Conectado a PostgreSQL (Supabase)");
    client.release();
  } catch (err) {
    console.error("Error en conexión Postgres:", err.message);
  }
})();