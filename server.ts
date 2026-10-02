import express, { Response, Request } from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import cookieParser from "cookie-parser";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
// @ts-expect-error types
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import Socket from "ws";
import Head from "ws";
import cors from "cors";
import config from "dotenv";
import { registerCloudRoutes } from "./src/cloudServer";

export function TServer() {
	config.config();
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = path.dirname(__filename);

	console.log("Starting Terbium...");
	const app = express();
	app.use(cookieParser());
	app.use(express.json({ limit: "50mb" }));
	registerCloudRoutes(app);

	const masqrCheck = process.env.MASQR && process.env.MASQR.toLowerCase() === "true";
	if (masqrCheck) {
		console.log(`Masqr is Enabled`);
	} else {
		console.log(`Masqr is Disabled`);
	}

	async function MasqFail(req, res) {
		if (!req.headers.host) {
			return;
		}
		const unsafeSuffix = req.headers.host + ".html";
		const safeSuffix = path.normalize(unsafeSuffix).replace(/^(\.\.(\/|\\|$))+/, "");
		const safeJoin = path.join(process.cwd() + "/Masqrd", safeSuffix);
		try {
			await fs.promises.access(safeJoin);
			const failureFileLocal = await fs.promises.readFile(safeJoin, "utf8");
			res.setHeader("Content-Type", "text/html");
			res.send(failureFileLocal);
			return;
		} catch (e) {
			res.setHeader("Content-Type", "text/html");
			res.send(fs.readFileSync("fail.html", "utf8"));
			return;
		}
	}

	if (masqrCheck) {
		app.use(async (req, res, next) => {
			// @ts-expect-error stfu
			if (req.headers.host && process.env.WHITELISTED_DOMAINS.includes(req.headers.host)) {
				next();
				return;
			}
			if (req.url.includes("/bare")) {
				next();
				return;
			}
			const authheader = req.headers.authorization;
			if (req.cookies["authcheck"]) {
				next();
				return;
			}
			if (req.cookies["refreshcheck"] != "true") {
				res.cookie("refreshcheck", "true", { maxAge: 10000 });
				MasqFail(req, res);
				return;
			}
			if (!authheader) {
				res.setHeader("WWW-Authenticate", "Basic");
				res.status(401);
				MasqFail(req, res);
				return;
			}

			const auth = Buffer.from(authheader.split(" ")[1], "base64").toString().split(":");
			const user = auth[0];
			const pass = auth[1];
			const licenseCheck = (await (await fetch(process.env.LICENSE_SERVER_URL + pass + "&host=" + req.headers.host)).json())["status"];
			console.log(`\x1b[0m${process.env.LICENSE_SERVER_URL}${pass}&host=${req.headers.host} ` + `returned: ${licenseCheck}`);
			if (licenseCheck == "License valid") {
				res.cookie("authcheck", "true", { expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) });
				res.send(`<script> window.location.href = window.location.href </script>`);
				return;
			}
			MasqFail(req, res);
			return;
		});
	}

	app.use(
		express.static("dist", {
			setHeaders: (res, path) => {
				if (path.endsWith(".cjs")) {
					res.setHeader("Content-Type", "text/javascript");
				}
			},
		}),
	);
	app.use("/libcurl/", express.static(libcurlPath));
	app.use("/baremux/", express.static(baremuxPath));
	app.use("/epoxy/", express.static(epoxyPath));
	wisp.options.dns_method = "resolve";
	wisp.options.dns_servers = ["1.1.1.3", "1.0.0.3"];
	wisp.options.dns_result_order = "ipv4first";
	const server = createServer();

	server.on("request", (req: Request, res: Response) => {
		app(req, res);
	});

	server.on("upgrade", (req: Request, socket: Socket, head: Head) => {
		if (req.url.endsWith("/wisp/")) {
			wisp.routeRequest(req, socket, head);
		}
	});

	const port = parseInt(process.env.PORT || "8080");
	const corsOptions = {
		origin: `http://localhost:${port}`,
		methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
		credentials: true,
	};

	app.use(cors(corsOptions));
	const manifest = fs.readFileSync(path.join(__dirname, "package.json"), "utf-8");
	const { version } = JSON.parse(manifest);
	server.listen(port, () => {
		console.log(`
  \x1b[38;2;50;174;98m@@@@@@@@@@@@@@~ B@@@@@@@@#G?.
  \x1b[38;2;50;174;98mB###&@@@@&####^ #@@@&PPPB@@@G.
  \x1b[38;2;50;174;98m .. ~@@@@J ..  .#@@@P   ~&@@@^      \x1b[38;2;60;195;240mWelcome to Terbium React v${version}
      \x1b[38;2;50;174;98m^@@@@?     .#@@@@###&@@&7
      \x1b[38;2;50;174;98m^@@@@?     .#@@@#555P&@@B7      \x1b[38;2;182;182;182mTerbium is running on ${port}
      \x1b[38;2;50;174;98m^@@@@?     .#@@@P    G@@@@      \x1b[38;2;182;182;182mAny problems you encounter let us know!
      \x1b[38;2;50;174;98m^@@@@?     .#@@@&GGG#@@@@Y
      \x1b[38;2;50;174;98m^&@@@?      B@@@@@@@@&B5~
    `);
	});

	process.on("SIGINT", () => {
		console.log("\x1b[0m");
		process.exit();
	});
}
