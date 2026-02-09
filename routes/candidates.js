import express from "express";
import { profileView, candidatesSearch, profileViewByRole } from "../controllers/candidatesController.js";

const router = express.Router();

router.get("/profile-view", profileView);
router.post("/search", candidatesSearch);
router.post("/profile-view-by-role", profileViewByRole);

export default router;
