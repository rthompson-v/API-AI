import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import chatRoutes from "./routes/chat.js";
import candidatesRoutes from "./routes/candidates.js";
import authRoutes from "./routes/auth.js";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Rutas (modularizadas)
import "./db.js"; // inicializa pool y prueba conexión

app.use("/chat", chatRoutes);
app.use("/candidates", candidatesRoutes);
app.use("/auth", authRoutes);

// Health check
app.get("/", (req, res) => res.json({ ok: true, msg: "Servidor IA activo" }));





const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor IA listo en http://localhost:${PORT}`);
});
