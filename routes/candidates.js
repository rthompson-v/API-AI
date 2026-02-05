import express from "express";
import { profileView, candidatesSearch } from "../controllers/candidatesController.js";

const router = express.Router();

router.get("/profile-view", profileView);
router.post("/search", candidatesSearch);

export default router;
