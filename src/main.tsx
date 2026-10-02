import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import Setup from "./Setup.tsx";
import Login from "./Login.tsx";
import Boot from "./Boot.tsx";
import CustomOS from "./CustomOS.tsx";
import Updater from "./Updater.tsx";
import { hash } from "./hash.json";
import { fileExists } from "./sys/types.ts";
import Loader from "./Loading.tsx";
import Recovery from "./Recovery.tsx";
import { BareMuxConnection } from "@mercuryworkshop/bare-mux";

const Root = () => {
	const [currPag, setPag] = useState(<Loader />);
	const params = new URLSearchParams(window.location.search);
	useEffect(() => {
		const tempTransport = async () => {
			const connection = new BareMuxConnection("/baremux/worker.js");
			await connection.setTransport("/epoxy/index.mjs", [{ wisp: `wss://wisp.terbiumon.top/wisp/` }]);
			const scramjet = new window.ScramjetController({
				prefix: "/service/",
				files: {
					wasm: "/scramjet/scramjet.wasm.wasm",
					worker: "/scramjet/scramjet.worker.js",
					client: "/scramjet/scramjet.client.js",
					shared: "/scramjet/scramjet.shared.js",
					sync: "/scramjet/scramjet.sync.js",
				},
				defaultFlags: {
					rewriterLogs: false,
				},
				codec: {
					encode: `
            if (!url) return Promise.resolve(url);
            let result = "";
	          let len = url.length;
	          for (let i = 0; i < len; i++) {
	            const char = url[i];
              result += i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char;
            }
	          return encodeURIComponent(result);
          `,
					decode: `
            if (!url) return Promise.resolve(url);
	          url = decodeURIComponent(url);
	          let result = "";
            let len = url.length;
	          for (let i = 0; i < len; i++) {
	            const char = url[i];
              result += i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char;
	          }
		        return result;
          `,
				},
			});
			scramjet.init();
			navigator.serviceWorker.register("/anura-sw.js");
		};
		tempTransport();
		if (sessionStorage.getItem("recovery")) {
			setPag(<Recovery />);
		} else if (sessionStorage.getItem("boot") || params.get("boot")) {
			const upd = async () => {
				let sha;
				if (await fileExists("/system/etc/terbium/hash.cache")) {
					sha = await Filer.fs.promises.readFile("/system/etc/terbium/hash.cache", "utf8");
				} else {
					sha = hash;
				}
				if (localStorage.getItem("setup")) {
					if (localStorage.getItem("setup") && (sha !== hash || sessionStorage.getItem("skipUpd"))) {
						setPag(<Updater />);
					} else {
						if (sessionStorage.getItem("logged-in") && sessionStorage.getItem("logged-in") === "true") {
							setPag(<App />);
						} else {
							setPag(<Login />);
						}
					}
				} else {
					setPag(<Login />);
				}
			};
			upd();
		} else if (sessionStorage.getItem("cusboot")) {
			setPag(<CustomOS />);
		} else {
			setPag(<Boot />);
		}
	}, []);
	return currPag;
};

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Root />
	</StrictMode>,
);
