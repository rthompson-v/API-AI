import pg from "pg";
import dns from "node:dns";

// Fuerza que Node.js resuelva hostnames con IPv4 primero.
// Necesario porque Railway no tiene ruta a las IPs IPv6 de Supabase.
dns.setDefaultResultOrder("ipv4first");

const { Pool } = pg;

// Configuración común de SSL para Supabase
const sslConfig = {
  rejectUnauthorized: false,
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
  database: process.env.DB_NAME2 || process.env.DB_NAME,
  ssl: sslConfig,
});

// Verifica conexión al iniciar
(async () => {
  try {
    const client = await pool1.connect();
    console.log("Conectado a PostgreSQL (Supabase)");
    client.release();
  } catch (err) {
    console.error("Error en conexión Postgres:", err.message);
  }
})();