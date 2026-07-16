import { Router } from "express";
import { search, suggestions, trending } from "../controllers/searchController.js";

const router = Router();

// ── Public: Search endpoints ──
router.get("/", search);
router.get("/suggestions", suggestions);
router.get("/trending", trending);

export default router;
