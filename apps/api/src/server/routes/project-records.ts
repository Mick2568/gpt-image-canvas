import type { Hono } from "hono";
import {
  createProjectRecord,
  createProjectRecordLink,
  getCreativeProjectDetail,
  getProjectRecordDetail,
  listCreativeProjects,
  ProjectRecordNotFoundError,
  ProjectRecordValidationError,
  updateProjectRecord,
  updateProjectRecordLink
} from "../../domain/project-records/project-record-store.js";
import type {
  CreateProjectRecordLinkRequest,
  CreateProjectRecordRequest,
  UpdateProjectRecordLinkRequest,
  UpdateProjectRecordRequest
} from "../../domain/contracts.js";
import { errorResponse } from "../http/errors.js";
import { readJson } from "../http/json.js";

export function registerProjectRecordRoutes(app: Hono): void {
  app.get("/api/creative-projects", (c) => c.json(listCreativeProjects()));

  app.get("/api/creative-projects/:projectId", (c) => {
    try {
      return c.json(getCreativeProjectDetail(c.req.param("projectId")));
    } catch (error) {
      return projectRecordErrorResponse(error);
    }
  });

  app.post("/api/creative-projects/:projectId/records", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    try {
      return c.json(createProjectRecord(c.req.param("projectId"), payload.value as CreateProjectRecordRequest), 201);
    } catch (error) {
      return projectRecordErrorResponse(error);
    }
  });

  app.get("/api/project-records/:recordId", (c) => {
    try {
      return c.json(getProjectRecordDetail(c.req.param("recordId")));
    } catch (error) {
      return projectRecordErrorResponse(error);
    }
  });

  app.put("/api/project-records/:recordId", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    try {
      return c.json(updateProjectRecord(c.req.param("recordId"), payload.value as UpdateProjectRecordRequest));
    } catch (error) {
      return projectRecordErrorResponse(error);
    }
  });

  app.post("/api/project-records/:recordId/links", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    try {
      return c.json(createProjectRecordLink(c.req.param("recordId"), payload.value as CreateProjectRecordLinkRequest), 201);
    } catch (error) {
      return projectRecordErrorResponse(error);
    }
  });

  app.put("/api/project-record-links/:linkId", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    try {
      return c.json(updateProjectRecordLink(c.req.param("linkId"), payload.value as UpdateProjectRecordLinkRequest));
    } catch (error) {
      return projectRecordErrorResponse(error);
    }
  });
}

function projectRecordErrorResponse(error: unknown): Response {
  if (error instanceof ProjectRecordValidationError) {
    return new Response(JSON.stringify(errorResponse(error.code, error.message)), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (error instanceof ProjectRecordNotFoundError) {
    return new Response(JSON.stringify(errorResponse(error.code, "Project record resource not found.")), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  throw error;
}
