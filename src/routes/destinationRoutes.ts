import { Router } from "express";
import { getAllDestinations, getDestination } from "../controllers/destinationController.js";

const router = Router();

// GET /api/destinations — public, paginated, sorted by popularity
router.get("/", getAllDestinations as any);

// GET /api/destinations/:slug — public, single destination by slug
router.get("/:slug", getDestination as any);

export default router;