import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type express from "express";

type SnapshotNode = { type: "file"; data: string } | { type: "dir"; children: Record<string, SnapshotNode> };

interface CloudAccount {
	username: string;
	passwordHash: string;
	snapshot: SnapshotNode | null;
	updatedAt: string;
}

interface CloudDatabase {
	accounts: Record<string, CloudAccount>;
	sessions: Record<string, string>;
}

const DATA_DIR = path.join(process.cwd(), ".terbium-cloud");
const DATA_FILE = path.join(DATA_DIR, "users.json");

function emptyDb(): CloudDatabase {
	return { accounts: {}, sessions: {} };
}

async function readDb(): Promise<CloudDatabase> {
	try {
		const raw = await fs.promises.readFile(DATA_FILE, "utf8");
		return { ...emptyDb(), ...JSON.parse(raw) };
	} catch {
		return emptyDb();
	}
}

async function writeDb(db: CloudDatabase) {
	await fs.promises.mkdir(DATA_DIR, { recursive: true });
	await fs.promises.writeFile(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

function token() {
	return crypto.randomBytes(32).toString("hex");
}

function safeUsername(value: unknown) {
	if (typeof value !== "string") return null;
	const username = value.trim().toLowerCase();
	return /^[a-z0-9._-]{3,32}$/.test(username) ? username : null;
}

function safeHash(value: unknown) {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function jsonError(res: express.Response, status: number, error: string) {
	res.status(status).json({ ok: false, error });
}

export function registerCloudRoutes(app: express.Express) {
	app.post("/api/cloud/register", async (req, res) => {
		const username = safeUsername(req.body?.username);
		const passwordHash = safeHash(req.body?.passwordHash);
		if (!username || !passwordHash) return jsonError(res, 400, "Invalid username or password.");

		const db = await readDb();
		if (db.accounts[username]) return jsonError(res, 409, "Cloud account already exists.");

		const sessionToken = token();
		db.accounts[username] = {
			username,
			passwordHash,
			snapshot: req.body?.snapshot || null,
			updatedAt: new Date().toISOString(),
		};
		db.sessions[sessionToken] = username;
		await writeDb(db);
		res.json({ ok: true, token: sessionToken, username });
	});

	app.post("/api/cloud/login", async (req, res) => {
		const username = safeUsername(req.body?.username);
		const passwordHash = safeHash(req.body?.passwordHash);
		if (!username || !passwordHash) return jsonError(res, 400, "Invalid username or password.");

		const db = await readDb();
		const account = db.accounts[username];
		if (!account || account.passwordHash !== passwordHash) return jsonError(res, 401, "Wrong cloud username or password.");

		const sessionToken = token();
		db.sessions[sessionToken] = username;
		await writeDb(db);
		res.json({ ok: true, token: sessionToken, username, snapshot: account.snapshot });
	});

	app.post("/api/cloud/push", async (req, res) => {
		const sessionToken = typeof req.body?.token === "string" ? req.body.token : "";
		const db = await readDb();
		const username = db.sessions[sessionToken];
		const account = username ? db.accounts[username] : null;
		if (!account) return jsonError(res, 401, "Cloud session expired.");

		account.snapshot = req.body?.snapshot || null;
		account.updatedAt = new Date().toISOString();
		await writeDb(db);
		res.json({ ok: true, username });
	});

	app.post("/api/cloud/pull", async (req, res) => {
		const sessionToken = typeof req.body?.token === "string" ? req.body.token : "";
		const db = await readDb();
		const username = db.sessions[sessionToken];
		const account = username ? db.accounts[username] : null;
		if (!account) return jsonError(res, 401, "Cloud session expired.");

		res.json({ ok: true, username, snapshot: account.snapshot });
	});
}
