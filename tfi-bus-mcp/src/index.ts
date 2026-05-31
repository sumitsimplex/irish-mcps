/**
 * TFI Bus MCP — Cloudflare Worker
 * Nationwide Transport for Ireland bus journey planning, timetables, stops and realtime departures.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createDb, type Env } from "./db/client";
import { getRealtimeDepartures } from "./tools/getRealtimeDepartures";
import { getRouteShape } from "./tools/getRouteShape";
import { getRoutesAtStop } from "./tools/getRoutesAtStop";
import { getTimetable } from "./tools/getTimetable";
import { listOperators } from "./tools/listOperators";
import { planJourney } from "./tools/planJourney";
import { searchStops } from "./tools/searchStops";

const TOOLS = [
  {
    name: "search_stops",
    description: "Search TFI bus stops by name, by latitude/longitude radius, or both. Use this before journey planning when a user names a place but not a stop_id.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional stop name or partial name, e.g. Heuston, Eyre Square, Parnell." },
        lat: { type: "number", description: "Optional latitude for nearby-stop search." },
        lon: { type: "number", description: "Optional longitude for nearby-stop search." },
        radius_km: { type: "number", description: "Optional search radius in kilometres when lat/lon are supplied." },
      },
      required: [],
    },
  },
  {
    name: "get_routes_at_stop",
    description: "List all bus routes serving a stop_id, including operator names and known trip headsigns. Use after search_stops or when the user asks what buses serve a stop.",
    inputSchema: {
      type: "object",
      properties: { stop_id: { type: "string", description: "GTFS stop_id from the TFI static feed." } },
      required: ["stop_id"],
    },
  },
  {
    name: "get_timetable",
    description: "Get the scheduled timetable for a route on a specific date, optionally filtered by direction. Use for planned services, not realtime disruption checks.",
    inputSchema: {
      type: "object",
      properties: {
        route_id: { type: "string", description: "GTFS route_id." },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Service date in YYYY-MM-DD format." },
        direction_id: { type: "number", enum: [0, 1], description: "Optional GTFS direction_id." },
      },
      required: ["route_id", "date"],
    },
  },
  {
    name: "plan_journey",
    description: "Find direct scheduled bus journeys between two stops on a date. This v1 planner does not include transfers; call it when the user has origin and destination stop_ids.",
    inputSchema: {
      type: "object",
      properties: {
        origin_stop_id: { type: "string", description: "Origin GTFS stop_id." },
        destination_stop_id: { type: "string", description: "Destination GTFS stop_id." },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Journey date in YYYY-MM-DD format." },
        depart_after: { type: "string", pattern: "^\\d{1,2}:\\d{2}$", description: "Earliest departure as HH:MM. Defaults to 00:00." },
      },
      required: ["origin_stop_id", "destination_stop_id", "date"],
    },
  },
  {
    name: "get_realtime_departures",
    description: "Fetch GTFS-Realtime trip updates and return the next expected departures at a stop. Use for live departure boards and delay checks.",
    inputSchema: {
      type: "object",
      properties: {
        stop_id: { type: "string", description: "GTFS stop_id." },
        limit: { type: "number", description: "Maximum departures to return. Defaults to 10." },
      },
      required: ["stop_id"],
    },
  },
  {
    name: "get_route_shape",
    description: "Return a representative route geometry as GeoJSON LineString for a route_id and optional direction. Use when mapping a bus route.",
    inputSchema: {
      type: "object",
      properties: {
        route_id: { type: "string", description: "GTFS route_id." },
        direction_id: { type: "number", enum: [0, 1], description: "Optional GTFS direction_id." },
      },
      required: ["route_id"],
    },
  },
  {
    name: "list_operators",
    description: "List public bus operators in the loaded nationwide TFI GTFS feed, with route counts. Use for discovery or filtering by agency.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
] as const;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function toolContent(value: unknown, isError = false): Record<string, unknown> {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    isError,
  };
}

async function callTool(name: string, args: Record<string, unknown>, env: Env): Promise<unknown> {
  const db = createDb(env);

  switch (name) {
    case "search_stops":
      return searchStops(db, args);
    case "get_routes_at_stop":
      return getRoutesAtStop(db, args);
    case "get_timetable":
      return getTimetable(db, args);
    case "plan_journey":
      return planJourney(db, args);
    case "get_realtime_departures":
      return getRealtimeDepartures(db, env, args);
    case "get_route_shape":
      return getRouteShape(db, args);
    case "list_operators":
      return listOperators(db);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function createMcpServer(env: Env): Server {
  const server = new Server(
    { name: "TFI Bus MCP", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions: "Use this server for Irish public bus stops, routes, timetables, direct scheduled journeys, route shapes and realtime departures.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: rawArgs } = request.params;
    const args = rawArgs && typeof rawArgs === "object" ? rawArgs as Record<string, unknown> : {};
    try {
      return toolContent(await callTool(name, args, env));
    } catch (error) {
      return toolContent({ error: error instanceof Error ? error.message : "Tool failed" }, true);
    }
  });

  return server;
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const server = createMcpServer(env);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  const response = await transport.handleRequest(request);
  await server.close();
  return withCors(response);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/mcp" || pathname === "/mcp/") return handleMcp(request, env);
    if (pathname === "/health") return json({ status: "ok", service: "TFI Bus MCP", version: "1.0.0" });
    if (pathname === "/" || pathname === "") {
      return json({
        service: "TFI Bus MCP",
        mcp_endpoint: "/mcp",
        tools: TOOLS.map(tool => ({ name: tool.name, description: tool.description })),
      });
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
