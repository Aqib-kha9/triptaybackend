import type { Request, Response, NextFunction } from "express";
import * as searchService from "../services/search.service.js";

// @desc    Unified search across listings and activities
// @route   GET /api/search
// @access  Public
export const search = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { q, type, city, state, minPrice, maxPrice, guests, sort, page, limit } = req.query;

    const result = await searchService.searchAll({
      q: q as string,
      type: type as string | undefined,
      city: city as string | undefined,
      state: state as string | undefined,
      minPrice: minPrice as string | undefined,
      maxPrice: maxPrice as string | undefined,
      guests: guests as string | undefined,
      sort: sort as string | undefined,
      page: page as string | undefined,
      limit: limit as string | undefined,
    });

    res.status(200).json({
      status: "success",
      results: result.results.length,
      pagination: result.pagination,
      data: { results: result.results },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Search autocomplete suggestions
// @route   GET /api/search/suggestions
// @access  Public
export const suggestions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = (req.query.q as string) || "";
    const result = await searchService.searchSuggestions(q);

    res.status(200).json({
      status: "success",
      results: result.suggestions.length,
      data: { suggestions: result.suggestions },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get trending searches
// @route   GET /api/search/trending
// @access  Public
export const trending = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await searchService.getTrendingSearches();

    res.status(200).json({
      status: "success",
      results: result.trending.length,
      data: { trending: result.trending },
    });
  } catch (error) {
    next(error);
  }
};
