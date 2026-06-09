import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index.ts";
import { resolveLockHolder } from "./identity.ts";
import { handleWorkflowMessage, parseWorkflowMessage } from "./workflow-ws.ts";
import type { WorkflowRecord } from "./workflow.ts";
import {
	broadcastWorkflowUpdate,
	buildConnectedFrame,
	buildHarnessRefresh,
	isWebSocketUpgrade,
	parseClientFilters,
	parseSinceSeq,
	parseWsAttachment,
	type WsSessionAttachment,
} from "./ws-sessions.ts";

export const SCRIBE_PROJECT = "ged";

export class Scribe extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health" && request.method === "GET") {
			return Response.json({
				ok: true,
				service: "scribe",
				project: SCRIBE_PROJECT,
				ws: "/events",
			});
		}

		if (url.pathname === "/events" && request.method === "GET") {
			return this.handleEvents(request, url);
		}

		return Response.json({ ok: false, error: "not found" }, { status: 404 });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const text = typeof message === "string" ? message : new TextDecoder().decode(message);
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return;
		}

		const type = (parsed as { type?: string })?.type;
		if (type === "ping") {
			ws.send(JSON.stringify({ type: "pong" }));
			return;
		}

		const cmd = parseWorkflowMessage(parsed);
		if (!cmd) return;

		const attachment = parseWsAttachment(ws.deserializeAttachment());
		if (!attachment?.holder_id) return;

		const holder = { holder_id: attachment.holder_id, holder_kind: attachment.holder_kind };
		const reply = await handleWorkflowMessage(cmd, {
			storage: this.ctx.storage,
			holder,
			filters: attachment.filters,
			harness: () => buildHarnessRefresh(this.ctx.storage, holder, attachment.filters),
			onChange: (record) => this.emitWorkflowUpdate(record),
		});
		if (reply) ws.send(JSON.stringify(reply));
	}

	async webSocketClose(): Promise<void> {
		// Hibernation — sessions reattach on next message.
	}

	private async emitWorkflowUpdate(record: WorkflowRecord): Promise<void> {
		await broadcastWorkflowUpdate(this.ctx.storage, this.ctx, SCRIBE_PROJECT, record);
	}

	private async handleEvents(request: Request, url: URL): Promise<Response> {
		if (!isWebSocketUpgrade(request)) {
			return Response.json({ ok: false, error: "upgrade required" }, { status: 426 });
		}
		const holder = resolveLockHolder(request, this.env);
		if (!holder) {
			return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		const project = url.searchParams.get("project")?.trim() || SCRIBE_PROJECT;
		const sinceSeq = parseSinceSeq(url);
		const filters = parseClientFilters(url.searchParams);
		const attachment: WsSessionAttachment = {
			filters,
			since_seq: sinceSeq,
			project,
			holder_id: holder.holder_id,
			holder_kind: holder.holder_kind,
		};

		this.ctx.acceptWebSocket(server);
		server.serializeAttachment(JSON.stringify(attachment));

		const connected = await buildConnectedFrame(this.ctx.storage, project, sinceSeq, {
			holder,
			filters,
		});
		server.send(JSON.stringify(connected));

		return new Response(null, { status: 101, webSocket: client });
	}
}
