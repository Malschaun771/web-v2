import { Filer, dirExists } from "./types";

export interface CloudUser {
	username: string;
	passwordHash: string;
}

interface SnapshotFile {
	type: "file";
	data: string;
}

interface SnapshotDirectory {
	type: "dir";
	children: Record<string, SnapshotNode>;
}

type SnapshotNode = SnapshotFile | SnapshotDirectory;

interface CloudResponse {
	ok: boolean;
	error?: string;
	token?: string;
	username?: string;
	snapshot?: SnapshotDirectory;
}

const TOKEN_KEY = "cloud-token";
const USER_KEY = "cloud-user";
const SYNC_PATHS = ["/home", "/apps", "/system", "/bootentries.json"];
const SKIP_PATHS = new Set(["/system/tmp"]);

async function sha256(input: string) {
	const bytes = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(hash))
		.map(byte => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function hashCloudPassword(username: string, password: string) {
	return sha256(`terbium-cloud-v1:${username}:${password}`);
}

async function api(path: string, body: unknown): Promise<CloudResponse> {
	const response = await fetch(`/api/cloud/${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const data = (await response.json()) as CloudResponse;
	if (!response.ok || !data.ok) {
		throw new Error(data.error || `Cloud request failed: ${path}`);
	}
	return data;
}

async function serializeNode(path: string): Promise<SnapshotNode | null> {
	if (SKIP_PATHS.has(path)) return null;
	try {
		const stat = await Filer.fs.promises.stat(path);
		if (stat.isDirectory()) {
			const children: Record<string, SnapshotNode> = {};
			const entries = await Filer.fs.promises.readdir(path);
			for (const entry of entries) {
				const childPath = path === "/" ? `/${entry}` : `${path}/${entry}`;
				const child = await serializeNode(childPath);
				if (child) children[entry] = child;
			}
			return { type: "dir", children };
		}
		const raw = await Filer.fs.promises.readFile(path, "utf8");
		return { type: "file", data: String(raw) };
	} catch (error) {
		console.warn(`Skipping cloud sync path ${path}`, error);
		return null;
	}
}

export async function exportCloudSnapshot(): Promise<SnapshotDirectory> {
	const children: Record<string, SnapshotNode> = {};
	for (const path of SYNC_PATHS) {
		const node = await serializeNode(path);
		if (node) children[path.replace(/^\//, "")] = node;
	}
	return { type: "dir", children };
}

async function ensureDir(path: string) {
	if (path === "/" || (await dirExists(path))) return;
	const parent = path.substring(0, path.lastIndexOf("/")) || "/";
	await ensureDir(parent);
	try {
		await Filer.fs.promises.mkdir(path);
	} catch (error) {
		if (!(await dirExists(path))) throw error;
	}
}

async function writeNode(path: string, node: SnapshotNode) {
	if (node.type === "dir") {
		await ensureDir(path);
		for (const [name, child] of Object.entries(node.children)) {
			await writeNode(path === "/" ? `/${name}` : `${path}/${name}`, child);
		}
		return;
	}
	const parent = path.substring(0, path.lastIndexOf("/")) || "/";
	await ensureDir(parent);
	await Filer.fs.promises.writeFile(path, node.data, "utf8");
}

export async function importCloudSnapshot(snapshot: SnapshotDirectory) {
	for (const [name, node] of Object.entries(snapshot.children)) {
		await writeNode(`/${name}`, node);
	}
	localStorage.setItem("setup", "true");
}

export function getCloudSession() {
	const token = sessionStorage.getItem(TOKEN_KEY);
	const username = sessionStorage.getItem(USER_KEY);
	return token && username ? { token, username } : null;
}

function setCloudSession(token: string, username: string) {
	sessionStorage.setItem(TOKEN_KEY, token);
	sessionStorage.setItem(USER_KEY, username);
}

export async function registerCloudAccount(username: string, password: string) {
	const passwordHash = await hashCloudPassword(username, password);
	const snapshot = await exportCloudSnapshot();
	const data = await api("register", { username, passwordHash, snapshot });
	setCloudSession(data.token!, username);
	return data;
}

export async function loginCloudAccount(username: string, password: string) {
	const passwordHash = await hashCloudPassword(username, password);
	const data = await api("login", { username, passwordHash });
	setCloudSession(data.token!, username);
	return data;
}

export async function restoreCloudAccount(username: string, password: string) {
	const login = await loginCloudAccount(username, password);
	if (!login.snapshot) throw new Error("Cloud account has no saved snapshot yet.");
	await importCloudSnapshot(login.snapshot);
	return login;
}

export async function pushCloudSnapshot() {
	const session = getCloudSession();
	if (!session) return false;
	const snapshot = await exportCloudSnapshot();
	await api("push", { token: session.token, snapshot });
	return true;
}

export async function pullCloudSnapshot() {
	const session = getCloudSession();
	if (!session) return false;
	const data = await api("pull", { token: session.token });
	if (data.snapshot) await importCloudSnapshot(data.snapshot);
	return true;
}
