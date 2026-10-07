window.__ModuleLoader__.load({
	id: "dsh-connect-workbuddy",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/status-paths.ts
		/**
		* Node-free constants and types shared by the Host and browser halves.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — 「3 条同源只读路由（usage / models:refresh / accounts:refresh）+ 一份
		*     与浏览器共享的 node-free 类型定义」的 host↔client 桥梁形态来自该项目
		*     （其 `status-paths.ts` 亦如此，并注明沿用
		*     corrinehu/dsh-workbuddy-connect 的 status-route 模式）。
		* 改动：路由路径改用本插件 id；类型字段按 WorkBuddy 上游实际给出的能力
		*   （积分倍率、多模态、推理档位）调整，不保留 trae 的 1M 变体字段。
		*
		* @module dsh-connect-workbuddy/status-paths
		*/
		/** Plugin-owned usage endpoint consumed by its browser half. */
		const WORKBUDDY_USAGE_PATH = "/plugins/dsh-connect-workbuddy/usage";
		/**
		* The project's public repository.
		*
		* Lives here rather than beside one component because TWO sections link to it
		* now — the model section and the account pool — and a second copy of a URL is
		* a second thing to forget when it moves. Node-free and side-effect free, so it
		* costs nothing on the Host side either.
		*/
		const WORKBUDDY_GITHUB_URL = "https://github.com/dingminhua/dsh-connect-workbuddy";
		/** Plugin-owned live model refresh endpoint. */
		const WORKBUDDY_MODELS_REFRESH_PATH = "/plugins/dsh-connect-workbuddy/models/refresh";
		/** Plugin-owned local account rescan endpoint. */
		const WORKBUDDY_ACCOUNTS_REFRESH_PATH = "/plugins/dsh-connect-workbuddy/accounts/refresh";
		/**
		* Plugin-owned model probe endpoint.
		*
		* Sends one minimal chat request per named model so the card can answer "is
		* this model usable right now, and if it is limited, when can it be used
		* again?". Lives on the Host because the credential must never reach the
		* browser half.
		*/
		const WORKBUDDY_PROBE_PATH = "/plugins/dsh-connect-workbuddy/probe";
		/**
		* Plugin-owned account-pool endpoint: one batch action per call.
		*
		* `?action=checkin` claims the daily reward for every account of a region;
		* `?action=test` probes every account against the region's target model. Both
		* are POST and loopback-only because both cost something real — check-in writes
		* to the user's account, a probe spends credits.
		*
		* Deliberately ONE endpoint rather than two: the two actions share every
		* guard (method, origin, region, pool-enabled) and differ only in the work, so
		* splitting them would duplicate the guards and invite them to drift apart.
		*/
		const WORKBUDDY_POOL_PATH = "/plugins/dsh-connect-workbuddy/pool";
		/** Query parameter selecting which pool batch action a request means. */
		const WORKBUDDY_POOL_ACTION_PARAM = "action";
		/** Address one region's pool endpoint with an action. */
		function withWorkBuddyRegionAndAction(path, region, action) {
			return `${withWorkBuddyRegion(path, region)}&${WORKBUDDY_POOL_ACTION_PARAM}=${action}`;
		}
		/** Query parameter naming the region a card request addresses. */
		const WORKBUDDY_REGION_PARAM = "region";
		/** Every region, in card tab order. */
		const WORKBUDDY_REGIONS = ["cn", "global"];
		/**
		* Address one region's status route. The two regions are separate provider
		* stacks; every card request carries the region whose tab the user is on.
		*/
		function withWorkBuddyRegion(path, region) {
			return `${path}?${WORKBUDDY_REGION_PARAM}=${region}`;
		}
		/**
		* Narrow a settings value to the `regions` map. Accepts EITHER the whole
		* settings section (the Host's resolved `Config`) OR the `regions` map itself,
		* and unwraps the former. This tolerance is deliberate: passing the whole
		* section where the map was expected was a real shipped bug in the sibling
		* project — the lookup then read `section['cn']` (absent), so the card's
		* checkbox reported `true` forever and clicking it appeared to do nothing even
		* though the write succeeded.
		*
		* The resolved section delivers `regions` as a `{get(): T}` LIVE reference, and
		* a live reference is `typeof === 'object'` and not an array — so it passes a
		* naive object check and gets returned as if it were the map. Every lookup on
		* it is then `undefined`: the enabled flag reads back as "on" forever (the very
		* symptom described above), and a merge that spreads this map silently drops
		* the region it was not editing. Unwrap before narrowing.
		*/
		function regionsMapOf(value) {
			const unwrapped = unwrapVolatileDeep(value);
			if (typeof unwrapped !== "object" || unwrapped === null || Array.isArray(unwrapped)) return {};
			const record = unwrapped;
			const nested = record["regions"];
			if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) return nested;
			return record;
		}
		/** One region's stored slot as a plain object; any other shape reads as empty. */
		function regionSlotOf(value, region) {
			const slot = regionsMapOf(value)[region];
			return typeof slot === "object" && slot !== null && !Array.isArray(slot) ? slot : {};
		}
		/**
		* Whether one region's provider is switched on. Opt-out semantics: only an
		* explicit `false` disables it, so a config written before this switch existed
		* (and the pre-region-split flat fields, which never carry `enabled`) keep both
		* providers running exactly as before. The Host reads the same rule through
		* `regionStateOf`, so card and Host can never disagree about a region's state.
		*
		* `value` may be the whole settings section or the `regions` map (see
		* {@link regionsMapOf}).
		*/
		function regionEnabledOf(value, region) {
			return regionSlotOf(value, region)["enabled"] !== false;
		}
		/** Build the next `regions` settings value for a signed-in tab's save. */
		function nextRegionSlots(regions, region, slot) {
			return {
				...typeof regions === "object" && regions !== null && !Array.isArray(regions) ? regions : {},
				[region]: slot
			};
		}
		/**
		* Build the next `regions` settings value for a provider on/off toggle. ONLY
		* the target region's `enabled` flag changes: every other field of that slot
		* (its directory, selection, image opt-ins, context budgets) and every other
		* region's slot are carried over verbatim, so switching a provider off never
		* discards the user's model picks and switching it back on restores them.
		*
		* This is deliberately separate from {@link nextRegionSlots}: that helper
		* writes a whole slot from a signed-in tab's draft, while this one must work
		* for a region that is signed OUT — which is precisely the region a user wants
		* to switch off (no international install, no international account).
		*
		* `value` may be the whole settings section or the `regions` map; the RETURN
		* value is always the `regions` map, i.e. exactly what `settingsScope.set(
		* 'regions', ...)` needs.
		*/
		/**
		* Build the next `regions` settings value for a MODEL-LIST save.
		*
		* The model save replaces a region slot wholesale, so the merge has to start
		* from the EXISTING slot rather than from a fresh object: the pool's
		* preferences live in that same slot, and a save that omitted them would delete
		* settings the user configured elsewhere in the card. Every writer that owns
		* only part of a slot goes through a helper like this one.
		*/
		function nextRegionModels(value, region, models) {
			return nextRegionSlots(regionsMapOf(value), region, {
				...regionSlotOf(value, region),
				...models
			});
		}
		/**
		* Build the next `regions` settings value for a POOL-PREFERENCES save.
		*
		* Same reasoning as {@link nextRegionModels}: the pool is one field of a slot
		* that also holds the model list, so the merge starts from the existing slot.
		*/
		function nextRegionPool(value, region, pool) {
			return nextRegionSlots(regionsMapOf(value), region, {
				...regionSlotOf(value, region),
				pool
			});
		}
		function nextRegionEnabled(value, region, enabled) {
			return nextRegionSlots(regionsMapOf(value), region, {
				...regionSlotOf(value, region),
				enabled
			});
		}
		/**
		* Project one card row into its persisted `lastCatalog` shape: the native
		* context window becomes the stored `contextWindow`, and the card-only
		* presentation fields (`nativeContextWindow`, `multimodal`) are removed BY
		* KEY. They must never be set to `undefined`: explicit `undefined` values
		* survive `structuredClone` and are rejected by the settings write path's
		* strict JSON codec (`client api: settings/mutate rejected "ops"`), which
		* fails the whole save.
		*/
		function toPersistedWorkBuddyModel(model) {
			const { nativeContextWindow, multimodal: _cardOnly, ...rest } = model;
			return {
				...rest,
				contextWindow: nativeContextWindow
			};
		}
		/**
		* Deep copy of a settings value with every `{get(): T}` live reference replaced
		* by the value it resolves to.
		*
		* `regions` and `accounts` are declared `asVolatile(...)`, and schemastery
		* resolves a volatile field to a live reference. That resolution happens in
		* schemastery itself, driven by the schema's `meta.volatile`, so it is
		* independent of the DSH line — the resolved section looks like this to the
		* browser half on BOTH 0.1.5 and 0.1.7.
		*
		* A live reference is still `typeof === 'object'`, so `{ ...reference }` does
		* NOT read the field: it produces `{ get: <function> }`. Any caller that
		* spreads the resolved field to preserve its siblings — the card's
		* "write one region, keep the other" merge — would otherwise DROP every
		* sibling and leak a function into the document. Both halves therefore unwrap
		* before touching a resolved field.
		*
		* Lives here, not in the Host entry, because the browser half needs it too and
		* this module is the node-free bridge between the two.
		*
		* Non-reference values are recursed into so a nested volatile field is caught
		* too — arrays and objects are rebuilt rather than mutated, so the caller's
		* value is never touched.
		*/
		function unwrapVolatileDeep(value) {
			if (value === null || typeof value !== "object") return value;
			if (typeof value.get === "function") return unwrapVolatileDeep(value.get());
			if (Array.isArray(value)) return value.map((entry) => unwrapVolatileDeep(entry));
			const source = value;
			const out = {};
			for (const key of Object.keys(source)) out[key] = unwrapVolatileDeep(source[key]);
			return out;
		}
		/**
		* The plugin's DECLARED settings namespace — the fallback name, not the value
		* the host necessarily serves.
		*
		* On 0.1.7 the settings service keys every form by the plugin's Loader entry id
		* (`describe()` returns `ns: entry.options.id`), and the harness resolves a
		* provider's namespace by EXACT match. The entry id is chosen by the profile
		* patch, so a plugin cannot know it in advance — the live Desktop host mounts
		* this one as `include:dsh-connect-workbuddy`.
		*
		* Lives here, not in the Host entry, because the browser half needs the same
		* fallback and must not import Node-only host code.
		*/
		const WORKBUDDY_SETTINGS_NS = "workbuddy";
		//#endregion
		//#region src/client/account-selection.ts
		/**
		* Verified writes of the per-region account slot.
		*
		* 参考：DSH 自带插件卡片（`@deepseek-ai/dsh-client-ui-settings-plugins`
		*   的 `CardForm.store()`）— 「写入后回读用户层并与写入值比对」这一校验形态，
		*   是本模块 `writeAccountSlot()` 的出发点。
		* 改动：针对账号槽位重写而非照搬 —— 回读的是**解析后的 section**而非 user 层
		*   （Host 的 legacy 归属也读它，两者必须同源），并用精确比较区分 `''`（哨兵清除）
		*   与 `undefined`（键缺失），因为后者会让区域重新回退到旧版 `accountId`。
		*
		* Kept out of `WorkBuddyCard.tsx` — and free of any browser-only import — so
		* the write contract can be unit-tested directly. The card is a `.tsx`
		* component whose module graph pulls DSH's browser packages, which cannot load
		* in the Node test environment; the check below is exactly the part that must
		* not go untested.
		*
		* @module dsh-connect-workbuddy/client/account-selection
		*/
		/**
		* A settings write that did not take effect.
		*
		* Distinct from a rejected `set()`: this is thrown when the write reported
		* success and the value is nonetheless absent from the document.
		*/
		var WorkBuddySettingsWriteError = class extends Error {
			/** The settings field that did not land. */
			field;
			constructor(field, reason) {
				super(`workbuddy: settings field "${field}" was not persisted by the settings write${reason === void 0 ? "" : `: ${reason}`}`);
				this.name = "WorkBuddySettingsWriteError";
				this.field = field;
			}
		};
		/**
		* Whether a save failure is a FILE-CONTENTION refusal.
		*
		* On Windows, replacing a file that another process holds open fails with
		* `EPERM` / `EBUSY` / `EACCES` — an antivirus scanner, a sync client (OneDrive),
		* or an editor with the profile's patch file open. POSIX `rename` replaces
		* outright regardless of open handles, so this branch effectively never fires
		* on macOS/Linux: the diagnosis is Windows-shaped because the failure is.
		*
		* It exists so a save failure can say WHAT TO DO. Without it the card pasted the
		* raw error at the user — `EPERM: operation not permitted, rename
		* 'C:\…\cordis.patch.yml.79498ff8fb27.tmp' -> '…\cordis.patch.yml'` — which
		* names a temp path and no remedy. Measured live against the 3.0.0 host with the
		* file held open: both the `regions` and `accounts` writes came back HTTP 500
		* with exactly that text.
		*
		* Deliberately matched on the message rather than on `WorkBuddySettingsWriteError`
		* alone: a validation refusal is also that class but has nothing to do with file
		* contention, and telling such a user to close their editor would send them
		* chasing a cause that is not there.
		*/
		function isFileContentionWriteError(error) {
			const message = error instanceof Error ? error.message : String(error);
			return /\b(?:EPERM|EBUSY|EACCES)\b/u.test(message);
		}
		/**
		* Read one settings field's current object value from the scope snapshot.
		*
		* The snapshot holds the RESOLVED section, where a volatile field
		* (`regions` / `accounts`) is a `{get(): T}` LIVE reference rather than the
		* plain object it resembles. Unwrapping first is not cosmetic: a live reference
		* is still `typeof === 'object'`, so without this the caller spreads it into
		* `{ get: <function> }` — which DROPS every sibling key (the other region) and
		* leaks a reference function into the document.
		*
		* That was the "saving the international region loses the domestic one" report:
		* every write here preserves the region it is not touching by spreading this
		* value, so reading it wrong silently deleted the untouched region.
		*/
		function fieldSnapshotOf(scope, field) {
			const value = unwrapVolatileDeep(scope.getSnapshot().value?.[field]);
			return typeof value === "object" && value !== null ? value : {};
		}
		/**
		* Fallback write: POST the field to the plugin's own Host endpoint.
		*
		* The endpoint handler runs the settings mutate inside the Host process and
		* reports the raw refusal exception, so a failure here names its cause instead
		* of arriving as a swallowed `ok:false`. It merges the posted region key into
		* the field's live value, preserving the other region.
		*/
		async function saveViaHostEndpoint(field, region, value) {
			let response;
			try {
				response = await fetch("/plugins/dsh-connect-workbuddy/__save", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						field,
						value: { [region]: value }
					})
				});
			} catch (error) {
				throw new WorkBuddySettingsWriteError(field, `Host save endpoint unreachable: ${String(error)}`);
			}
			if (!response.ok) {
				const detail = await response.json().catch(() => ({ error: `HTTP ${String(response.status)}` }));
				const reason = `${String(detail.errorName ?? "")} ${String(detail.error ?? "")}`.trim();
				throw new WorkBuddySettingsWriteError(field, `Host save refused: ${reason === "" ? String(detail.error) : reason}`);
			}
			return (await response.json().catch(() => void 0))?.value;
		}
		/**
		* Write one volatile field, then confirm the value actually landed.
		*
		* ORDER MATTERS, and getting it wrong DELETES DATA. The two writers do not have
		* the same semantics:
		*
		* - The Host save endpoint merges the posted region into the field's
		*   AUTHORITATIVE value inside the Host process, preserving every other region.
		* - `scope.set(field, next)` hands the settings service the WHOLE field, merged
		*   on the CLIENT out of the browser mirror. The Host performs no server-side
		*   merge on this path, so whatever the client built REPLACES the field.
		*
		* The mirror is not a reliable merge base: a write made through the Host
		* endpoint does not update it (that lag is documented on `contextBudgets`
		* below), and on the affected 0.1.7 deployment the mirror for this namespace
		* stays stale outright. Building the merge from it therefore produced
		* `{ [region]: slot }` with every SIBLING region missing — and `scope.set`
		* stores that verbatim, deleting them. That was the report "I saved the
		* domestic region and the international one was gone": `accounts` survived
		* (written while the mirror happened to be fresh) while `regions` lost a slot.
		*
		* So the Host endpoint goes FIRST — it is the only writer that cannot delete a
		* sibling. `scope.set` is then attempted purely as a mirror refresh, and only
		* when it delivers is the write considered done without the endpoint.
		*
		* `landed` decides whether a value read back from the scope is the value that
		* was written; it is per-field because `''` (a cleared account slot) and an
		* absent key are different states, and a truncated model catalog must not pass
		* a shallow "is anything there?" check.
		*
		* @throws {WorkBuddySettingsWriteError} when neither path persists the value.
		*/
		async function writeField(scope, field, region, value, landed) {
			let hostError;
			try {
				const authoritative = await saveViaHostEndpoint(field, region, value);
				if (authoritative !== void 0) try {
					await scope.set(field, authoritative);
				} catch {}
				return;
			} catch (error) {
				hostError = error;
			}
			let scopeDelivered = false;
			try {
				scopeDelivered = await scope.set(field, {
					...fieldSnapshotOf(scope, field),
					[region]: value
				}) !== false;
			} catch {
				scopeDelivered = false;
			}
			if (scopeDelivered && landed(fieldSnapshotOf(scope, field)[region])) return;
			throw hostError instanceof Error ? hostError : new WorkBuddySettingsWriteError(field, "neither the Host save endpoint nor the settings scope persisted the value");
		}
		/**
		* Write one region's account slot, then confirm the value actually landed.
		*
		* `settingsScope.set()` resolving is NOT proof that anything was stored. The
		* Host's document is the active profile's patch file (`cordis.patch.yml`, the
		* `config-editor`'s `documentPath`; volatile fields land there too, through
		* the same `edit()`. `settings.yaml` is NOT it on the 0.1.7 line — that file
		* is imported once from earlier releases and renamed to
		* `settings.yaml.imported`), replaced by writing a temp file and
		* renaming it over the target; on Windows an antivirus scanner, a sync client
		* (OneDrive, Dropbox), or an open editor can hold the file briefly.
		* `@deepseek-ai/dsh-atomic-write` retries `EPERM` / `EBUSY` / `EACCES` a
		* bounded number of times and those retries exist only for `win32` — and once
		* they are exhausted the failure reaches the client as an unsuccessful
		* response, which the settings scope handles by reloading Host state and
		* merely RETURNING. The caller's `await` therefore succeeds while the document
		* is unchanged.
		*
		* Reading the field back is the only reliable check, and it is what the
		* official plugin cards do (`CardForm.store()` compares the user layer against
		* the value it wrote). Failing loudly matters most on Clear: a false success
		* would flip the card to "following the app's sign-in" while the old selection
		* keeps running — the exact confusion that state line exists to remove.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param region - the region whose slot is written; the other is preserved.
		* @param value - the account id to save, or `''` to clear the region.
		* @throws {WorkBuddySettingsWriteError} when the value is readable back as
		*   something else — i.e. the write silently did not persist.
		*/
		async function writeAccountSlot(scope, region, value) {
			await writeField(scope, "accounts", region, value, (readBack) => readBack === value);
		}
		/**
		* Write one region's saved model state, then confirm it actually landed.
		*
		* The same silent-failure mode as {@link writeAccountSlot} applies to EVERY
		* settings write, not just the account slot. It matters here for a different
		* reason: a successful save discards the user's draft, so a write that did not
		* persist makes the card throw away unsaved edits while claiming they were
		* saved — unrecoverable, since the drafts are the only copy.
		*
		* Verification compares the round-tripped `lastCatalog` ids, which is the part
		* of the payload that is both user-visible and cheap to compare; the selection
		* fields ride along in the same object and cannot land separately.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param region - the region whose model slot is written.
		* @param payload - the complete next state for that region's slot.
		* @throws {WorkBuddySettingsWriteError} when the catalog does not read back.
		*/
		async function writeRegionModels(scope, region, payload) {
			const next = nextRegionModels(scope.getSnapshot().value, region, payload)[region];
			const written = payload.lastCatalog.map((model) => model.id);
			await writeField(scope, "regions", region, next, (readBack) => {
				const stored = readBack?.lastCatalog?.map((model) => model.id);
				return stored !== void 0 && stored.length === written.length && stored.every((id, index) => id === written[index]);
			});
		}
		/**
		* Switch one region's provider off or on, with the same landed-check as every
		* other settings write.
		*
		* This exists because the toggle was the ONE write that still called
		* `scope.set()` directly. On the affected 0.1.7 deployments that scope settles
		* without storing anything, so flipping a provider off appeared to work and
		* then silently reverted — the exact silent-failure mode
		* {@link writeAccountSlot} and {@link writeRegionModels} were written to
		* prevent for their own fields. Routing it through {@link writeField} gives it
		* the same scope-first-then-Host-endpoint path, so the switch either lands or
		* reports why it did not.
		*
		* The write carries the region's whole slot through untouched — only `enabled`
		* changes — so the user's directory, model picks, image opt-ins and budgets
		* survive the round trip. The Host withdraws or restores the provider route on
		* the next `onChange`, which is what actually removes it from DSH's model
		* picker.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param region - the region being switched.
		* @param enabled - the desired state.
		* @param slot - the region's COMPLETE next slot (the caller owns the snapshot
		*   read and the whole-slot merge, so this stays a pure write).
		* @throws {WorkBuddySettingsWriteError} when neither writer persists the value.
		*/
		async function writeRegionEnabled(scope, region, enabled, slot) {
			await writeField(scope, "regions", region, slot, (readBack) => {
				const stored = readBack;
				return stored !== null && stored !== void 0 && stored["enabled"] === enabled;
			});
		}
		/**
		* Write one region's account-pool PREFERENCES, verifying they landed.
		*
		* Routed through {@link writeField} like every other settings write, so it gets
		* the same Host-endpoint-first path and the same landed check. The card treats
		* a resolved write as "the draft is now safe to discard", so a write that
		* silently did nothing would throw away the user's edits while reporting
		* success — unrecoverable, since the draft is the only copy.
		*
		* The COMPLETE region slot is passed in by the caller for the same reason
		* {@link writeRegionEnabled} does it: the pool lives INSIDE the region slot
		* alongside `lastCatalog`/`enabledModelIds`, so writing only the pool field
		* would drop the model list.
		*
		* Deliberately does NOT carry the pool's measured facts. Those are written by
		* the Host to its own file; keeping them out of settings is what stops a save
		* from rolling back a test result the timer had just recorded.
		*
		* @param scope - the bound settings scope for this plugin's namespace.
		* @param region - the region whose pool preferences are written.
		* @param preferences - the preference fields, as the user set them.
		* @param slot - the region's COMPLETE next slot (caller owns the merge).
		* @throws {WorkBuddySettingsWriteError} when neither writer persists the value.
		*/
		async function writePoolPreferences(scope, region, preferences) {
			const slot = {
				enabled: preferences.enabled,
				targetModelId: preferences.targetModelId,
				memberAccountIds: preferences.memberAccountIds
			};
			if (preferences.probeInputTokens !== void 0) slot["probeInputTokens"] = preferences.probeInputTokens;
			const next = nextRegionPool(scope.getSnapshot().value, region, slot)[region];
			await writeField(scope, "regions", region, next, (readBack) => {
				const pool = readBack?.pool;
				if (pool === void 0 || pool === null) return false;
				if (pool["enabled"] !== preferences.enabled || pool["targetModelId"] !== preferences.targetModelId) return false;
				const wantedTokens = preferences.probeInputTokens ?? 0;
				if ((pool["probeInputTokens"] ?? 0) !== wantedTokens) return false;
				const stored = pool["memberAccountIds"];
				if (!Array.isArray(stored) || stored.length !== preferences.memberAccountIds.length) return false;
				const wanted = new Set(preferences.memberAccountIds);
				return stored.every((id) => typeof id === "string" && wanted.has(id));
			});
		}
		//#endregion
		//#region src/client/ndjson.ts
		/**
		* Read a newline-delimited JSON body, one object at a time.
		*
		* NDJSON rather than SSE or a hand-rolled frame format because the pool's batch
		* is a list of INDEPENDENT results: one line per result needs no state machine,
		* survives a partially-delivered batch, and lets the reader act on account N
		* while account N+1 is still being tested.
		*
		* A malformed line is SKIPPED, not fatal. The stream carries live progress, so
		* discarding the rest of a batch because one frame did not parse would throw away
		* rows the user already watched arrive — and a truncated final line is a normal
		* way for a stream to end when something upstream misbehaves.
		*
		* @module dsh-connect-workbuddy/client/ndjson
		*/
		/** Hand each parsed object to `onLine`, in order, as it arrives. */
		async function readNdjson(body, onLine) {
			const reader = body?.getReader();
			if (reader === void 0) return;
			const decoder = new TextDecoder();
			const emit = (line) => {
				const trimmed = line.trim();
				if (trimmed === "") return;
				try {
					const parsed = JSON.parse(trimmed);
					if (typeof parsed === "object" && parsed !== null) onLine(parsed);
				} catch {}
			};
			let buffer = "";
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) emit(line);
				}
				buffer += decoder.decode();
				emit(buffer);
			} finally {
				reader.releaseLock();
			}
		}
		//#endregion
		//#region src/client/probe-reason.ts
		/**
		* Outcomes whose label + stated recovery time ARE the whole story.
		*
		* Both carry a reset instant, which the row prints right beside them; their
		* bodies restate that instant and add a `code`/`requestId` pair nobody reads.
		*
		* `credential-rejected` and `not-found` are deliberately NOT here: their labels
		* state a conclusion ("sign in again", "no such model"), and the upstream's own
		* words are what make that conclusion checkable rather than asserted.
		*/
		const SELF_EXPLANATORY = /* @__PURE__ */ new Set(["rate-limited", "out-of-credit"]);
		/**
		* Longest inline reason kept.
		*
		* A cap rather than a wrapper: one pathological body must not push the rest of
		* the table off screen. 72 characters holds a full transport error and a full
		* upstream sentence, while stopping well short of a raw JSON document.
		*/
		const REASON_LIMIT = 72;
		/** The inline reason for one measurement, or `undefined` when it adds nothing. */
		function inlineProbeReason(outcome, message) {
			if (message === void 0 || message === "") return void 0;
			if (SELF_EXPLANATORY.has(outcome)) return void 0;
			const text = (humanSentenceOf(message) ?? stripTransportPrefix(message)).trim();
			return text === "" ? void 0 : truncate(text);
		}
		function truncate(text) {
			return text.length <= REASON_LIMIT ? text : `${text.slice(0, 71)}…`;
		}
		/** `{"code":6004,"msg":"…","requestId":"…"}` → the `msg` sentence, if it has one. */
		function humanSentenceOf(message) {
			if (!message.startsWith("{")) return void 0;
			let parsed;
			try {
				parsed = JSON.parse(message);
			} catch {
				return;
			}
			if (typeof parsed !== "object" || parsed === null) return void 0;
			const msg = parsed["msg"];
			return typeof msg === "string" && msg !== "" ? msg : void 0;
		}
		/** `transport error: TimeoutError: …` → `TimeoutError: …`. */
		function stripTransportPrefix(message) {
			return message.replace(/^transport error:\s*/u, "");
		}
		//#endregion
		//#region src/client/probe-age.ts
		const MINUTE_MS$1 = 6e4;
		const HOUR_MS$1 = 60 * MINUTE_MS$1;
		const DAY_MS$1 = 24 * HOUR_MS$1;
		/**
		* How long ago a measurement was taken, coarsely: "刚刚", "N 分钟前",
		* "N 小时前", "N 天前".
		*
		* Coarse on purpose, for the same reason `remainingText` rounds: a figure that
		* changes every second reads as live telemetry rather than as "how stale is
		* this", which is the only question being asked here.
		*
		* A clock skew that puts the measurement in the FUTURE (a stored `atMs` ahead
		* of `nowMs`, from a machine whose clock moved backwards) is reported as
		* "刚刚" rather than as a negative age: the record is real, and the card must
		* not print "-3 分钟前".
		*/
		function probeAgeText(t, atMs, nowMs) {
			const age = nowMs - atMs;
			if (age < MINUTE_MS$1) return t("row.poolProbeJustNow");
			if (age < HOUR_MS$1) return t("row.poolProbeMinutesAgo", { count: Math.round(age / MINUTE_MS$1) });
			if (age < 2 * DAY_MS$1) return t("row.poolProbeHoursAgo", { count: Math.round(age / HOUR_MS$1) });
			return t("row.poolProbeDaysAgo", { count: Math.round(age / DAY_MS$1) });
		}
		//#endregion
		//#region src/probe.ts
		/**
		* The probe sizes the card offers, in tokens.
		*
		* A closed set, each step a meaningful position relative to the measured 20k~30k
		* threshold: below it (10k/20k) proves an account can serve SHORT requests and
		* is the cheap choice; at it (30k) is the size that finally covers the whole
		* measured window; above it (50k/100k) is for conversations that routinely run
		* long, where a smaller probe would report "usable" for an account that refuses
		* the very next message.
		*
		* Exported so the schema's description, the card's dropdown, and the coercion
		* below cannot drift apart into three different menus.
		*/
		const PROBE_INPUT_TOKEN_CHOICES = [
			1e4,
			2e4,
			3e4,
			5e4,
			1e5
		];
		//#endregion
		//#region src/client/remaining.ts
		const MINUTE_MS = 6e4;
		const HOUR_MS = 60 * MINUTE_MS;
		const DAY_MS = 24 * HOUR_MS;
		/**
		* How far out hours stop being the useful unit.
		*
		* Below this, hours; at or above it, days. The cut is at TWO days rather than
		* one so that 30 hours reads as "约 30 小时后" instead of rounding to "约 1 天后",
		* which would understate it by six hours.
		*/
		const DAYS_AT_MS = 2 * DAY_MS;
		/**
		* A short "约 N 分钟后 / 约 N 小时后 / 约 N 天后", or `''` once the moment passed.
		*
		* The empty string is the contract callers depend on: an elapsed cooldown means
		* the account is already back, so appending "in 0 minutes" would assert the
		* opposite of the state the card is showing. Callers append this only when it is
		* non-empty.
		*
		* Rounding is deliberately coarse — "约 1 小时后" for 69 minutes is what a reader
		* wants, and a precision that changes every minute would be noise rather than
		* information. The absolute instant sits right beside it for anyone who needs it.
		*/
		function remainingText(t, untilMs, nowMs) {
			const left = untilMs - nowMs;
			if (left <= 0) return "";
			if (left < MINUTE_MS) return t("row.remainingImminent");
			if (left < HOUR_MS) return t("row.remainingMinutes", { count: Math.round(left / MINUTE_MS) });
			if (left < DAYS_AT_MS) return t("row.remainingHours", { count: Math.round(left / HOUR_MS) });
			return t("row.remainingDays", { count: Math.round(left / DAY_MS) });
		}
		//#endregion
		//#region src/account-pool.ts
		/**
		* The checked ids that still resolve to a local sign-in, in the caller's order.
		*
		* This is THE definition of "effective members", and it exists because the same
		* predicate was written five separate times: the status document
		* (`web-status.ts`), the batch route's empty-pool guard, the Host dependency the
		* card reads, `poolMemberAccounts` and the browser helper. Five copies of one
		* rule is this project's single most productive bug shape ("fixed one end,
		* missed the other"), so the rule now has one home and every site delegates to
		* it.
		*
		* ORDER IS THE CALLER'S, and comes from `orderedIds`: the answer preserves the
		* order of THAT argument. Callers pass whichever list's order they want to show
		* — the saved list for the user's own order, the store's roster for the account
		* table's. Neither is silently reshuffled by the filter. (The first parameter was
		* once named `saved`, which read as "this must be the saved list" even though
		* `web-status.ts` legitimately passes the roster for store order; the name was
		* the trap, so it now describes the ROLE instead of the source.)
		*
		* Pure, so it is unit-testable without a store, and it never mutates its input.
		*/
		function effectiveMembersOf(orderedIds, listedIds) {
			return orderedIds.filter((id) => listedIds.has(id));
		}
		/**
		* A latest-wins guard for one region's asynchronous work.
		*
		* Exists because `applyRotation` awaits (it fetches credits per member), so two
		* overlapping calls can interleave: a slow call that read "rotation is ON" can
		* resume AFTER a newer call cleared the override for "rotation is OFF" and write
		* the stale account back — leaving the card showing the pool switched off while
		* a rotated account is still billed.
		*
		* `begin()` claims a new generation and returns a probe; the caller must check
		* it after EVERY await and bail when it reports stale. Extracted as a pure
		* factory rather than inlined so the rule is unit-testable: an inlined token is
		* only observable by reproducing a real interleaving, which is slow and easy to
		* get subtly wrong (a harness that never actually overlaps passes either way).
		*/
		function createLatestWins() {
			const generations = {};
			return { begin(key) {
				const generation = (generations[key] ?? 0) + 1;
				generations[key] = generation;
				return () => generations[key] !== generation;
			} };
		}
		//#endregion
		//#region src/client/pool-state.ts
		/**
		* Pure decision helpers for the account pool's card section.
		*
		* 参考：`src/account-pool.ts` 的做法——把「判定规则」从组件里抽出来，让规则本身
		*   可被单测直接钉住，而不是只能通过渲染整棵组件树间接观察。
		* 改动：新增本模块，收纳三组此前内联在 `AccountPool.tsx` 里的判定。抽出它们的
		*   直接原因是**独立验证发现 H-1/H-2 两个最高危修复没有任何自动化回归测试**：
		*   内联在组件里就只能靠真实渲染验证，而渲染测试既慢又容易被隔离问题骗过。
		*
		* 本模块不 import React、不碰网络，纯函数、全函数。
		*
		* @module dsh-connect-workbuddy/client/pool-state
		*/
		/**
		* The base a draft edit starts from.
		*
		* Resolved at EDIT time rather than captured when the callback was built. The
		* defect this fixes: the callback's dependency list named individual scalar
		* fields, so a field added later (`memberAccountIds`) was missing from it and
		* the callback kept a STALE base — checking one account then silently dropped
		* another that had been saved in between.
		*
		* `previous` is the draft already in state; it only applies to the region it
		* was made on, because the two pools are independent and one region's unsaved
		* edits must never seed the other's.
		*/
		function draftBaseFor(previous, previousRegion, region, saved) {
			return previous !== null && previousRegion === region ? previous : saved;
		}
		/**
		* Membership that resolves to a real local sign-in — what a batch runs on.
		*
		* The HOST computes this and sends it; this helper only chooses which answer to
		* trust. Counting the raw saved list is what let the UI claim "已选 1 / 共 1"
		* and enable both buttons while the batch ran on ZERO accounts and reported
		* success, so:
		*
		*   - while the draft is CLEAN, the Host's answer is authoritative (it reflects
		*     what would actually run, including sign-ins that have since disappeared);
		*   - while the draft is DIRTY, it must be derived from the edited list, since
		*     the Host's answer describes the SAVED state and would ignore the edit the
		*     user is looking at.
		*/
		function effectiveMemberIds(input) {
			if (!input.dirty) return [...input.savedEffective];
			return effectiveMembersOf(input.draftMembers, input.listedIds);
		}
		/**
		* Saved member ids with no matching sign-in.
		*
		* Surfaced rather than silently ignored: the ids remain in the user's saved
		* list (a login can come back), so the card has to explain why the pool behaves
		* as though they were absent.
		*/
		function ghostMemberIds(draftMembers, listedIds) {
			return draftMembers.filter((id) => !listedIds.has(id));
		}
		/**
		* How many accounts a batch will really touch, as the log announces it.
		*
		* Mirrors the HOST's own resolution exactly — `effective ?? saved` in the pool
		* route — because the number in the activity log must describe what the Host
		* runs, not what the card happens to display. Two wrong answers are possible and
		* both were live at different times:
		*
		*   - counting the raw SAVED list overstates it, so a ghost-only pool logged
		*     "checking in 1 account(s)" and was then refused with 409 having touched
		*     nothing;
		*   - counting the DRAFT-derived set announces unsaved edits the Host will not
		*     run (it reads the committed config).
		*
		* `savedEffective` is `undefined` only for a Host too old to send it, where the
		* saved list is the best available answer — the same fallback the route uses.
		*/
		function announcedBatchCount(input) {
			return (input.savedEffective ?? input.savedMembers).length;
		}
		/**
		* Localize a pool route failure from its structured cause.
		*
		* Lives here, not in `AccountPool.tsx`, because the card's module graph pulls
		* DSH's browser packages and there is no jsdom in this project — a rule left
		* inside the component cannot be tested at all. That is not hypothetical: the
		* independent verification deleted this function's `no-live-members` branch AND
		* both locale copies of its copy, and the whole 618-test suite still passed.
		* Extracting it is what lets `tests/pool-state.spec.ts` pin every branch.
		*
		* Returns undefined for an unknown cause so the caller can fall back to the
		* Host's own words — a new cause added upstream must still be visible rather
		* than swallowed into a generic message.
		*
		* `detail` is the Host's raw `error` text, used only where the sentence has a
		* slot for it (`pool-failed`). It is NOT the primary path: echoing English
		* developer prose into a Chinese UI was the defect this function exists to
		* prevent, and only the cases with no structured cause fall back to it.
		*/
		function poolErrorText(t, reason, detail) {
			switch (reason) {
				case "no-members": return t("row.poolErrNoMembers");
				case "no-live-members": return t("row.poolErrNoLiveMembers");
				case "no-free-model": return t("row.poolErrNoFreeModel");
				case "target-model-stale": return t("row.poolErrStaleModel");
				case "checkin-unsupported": return t("row.poolErrNoCheckin");
				case "pool-unavailable": return t("row.poolErrUnavailable");
				case "pool-failed": return t("row.poolErrFailed", { message: detail ?? "" });
				default: return;
			}
		}
		/**
		* The message to show for a failed pool request, from every signal available.
		*
		* The three-tier rule, in order, and why each tier exists:
		*
		*  1. the STRUCTURED cause, localized — the Host's `error` is an English
		*     developer sentence, and echoing it put untranslated prose in a Chinese UI;
		*  2. the Host's raw text, for a cause this build does not know — still more
		*     informative than a generic message, and it keeps a new upstream cause
		*     visible rather than swallowed;
		*  3. a message keyed on the STATUS — every pool exit that carries no reason
		*     (405/403/400 and the generic 500) otherwise reached the user as bare
		*     English like `HTTP 405`.
		*
		* Extracted from the card for the same reason as {@link poolErrorText}: a rule
		* inside the browser-only `.tsx` cannot be tested, and the status tier in
		* particular had no guard at all — reverting it to `` `HTTP ${status}` `` left
		* the entire suite green.
		*/
		function poolFailureText(t, input) {
			return poolErrorText(t, input.reason, input.error) ?? input.error ?? t("row.poolErrHttp", { status: String(input.status) });
		}
		/**
		* Pool MEMBERS that can serve right now.
		*
		* Judged over members only. Using the whole account table made the "no usable
		* account" warning unreachable: unchecked rows are listed for the user to opt
		* into and never carry `excludedBy`, so any unchecked sign-in kept the count
		* above zero — exactly when every member was limited and the explanation was
		* most needed.
		*/
		function usableMemberIds(accounts, effectiveMembers, draftMembers) {
			const wanted = /* @__PURE__ */ new Set([...effectiveMembers, ...draftMembers]);
			return accounts.filter((account) => wanted.has(account.accountId) && account.excludedBy === void 0).map((account) => account.accountId);
		}
		//#endregion
		//#region src/client/AccountPool.tsx
		/**
		* The account pool's card section.
		*
		* 参考：`WorkBuddyCard.tsx` 的既有写法 —— 草稿态 + dirty 标记 + 「保存/放弃」、
		*   60 秒轮询、`writeField` 验证写入，全部沿用；样式类名继续用
		*   `dsm-workbuddy-*` 前缀，好让这一块与卡片其余部分共用同一套外观语言。
		* 改动：把「账号池」这一整块独立成模块。原因是它有三条别的区块没有的规则，
		*   放在卡片里会被淹没：
		*
		*   1. **一种状态、两套写入。** 偏好（启用、目标模型、成员）走草稿 + 保存
		*      （保存成功才丢弃草稿）；**测试结果**是运行时事实，由 Host 在批量测试后
		*      自动落盘，绝不经这个保存按钮。把它们混在一起，一次「保存」就会用旧草稿
		*      覆盖刚测出的结果。
		*   2. **免费模型可能不存在。** 国内版静态目录不带倍率，所以「自动挑免费模型」
		*      在国内版首次刷新前会挑到空。此时**不回退到收费模型**，而是如实说明并
		*      停用测试按钮。
		*   3. **签到只在有它的区域出现。** 海外区域没有签到，按钮与那一列都不渲染；
		*      Host 侧同样拒绝该动作，免得留下一个界面看不见、接口却还能打的死角。
		*
		* @module dsh-connect-workbuddy/client/AccountPool
		*/
		/** How many activity lines are kept; the oldest are dropped. */
		const LOG_LIMIT = 60;
		/**
		* Activity logs, kept per region OUTSIDE the component.
		*
		* The card unmounts its whole body when collapsed (`WorkBuddyCard.tsx:832`
		* renders it only while `open`), and again whenever a poll briefly leaves the
		* region unsigned-in. Component state therefore lost the entire log on every
		* collapse. Holding it here keeps the history across remounts and across tab
		* switches.
		*/
		const logStore = /* @__PURE__ */ new Map();
		/**
		* Whether two id sets are equal, ignoring order.
		*
		* The membership compare must not depend on click order: re-selecting the same
		* accounts in a different sequence is not an edit, and treating it as one would
		* light up "unsaved changes" for a no-op.
		*/
		function sameIds(left, right) {
			if (left.length !== right.length) return false;
			const wanted = new Set(right);
			return left.every((id) => wanted.has(id));
		}
		/** Whether a probe outcome means the model answered. */
		function outcomeOk(outcome) {
			return outcome === "ok";
		}
		/** A short, localizable label for one probe outcome. */
		function outcomeText(t, outcome) {
			switch (outcome) {
				case "ok": return t("row.probeOk");
				case "rate-limited": return t("row.poolExcludedRateLimited");
				case "out-of-credit": return t("row.poolExcludedOutOfCredit");
				case "credential-rejected": return t("row.probeCredentialRejected");
				case "not-found": return t("row.probeNotFound");
				case "unavailable": return t("row.probeUnavailable");
				default: return t("row.probeFailed");
			}
		}
		function formatNumber$1(value) {
			return new Intl.NumberFormat(void 0, { maximumFractionDigits: 0 }).format(value);
		}
		/**
		* `MM/DD, HH:mm` on a 24-hour clock.
		*
		* `hourCycle: 'h23'` is REQUIRED, not decorative: without it `Intl` follows the
		* browser locale's preference, and en-US renders `09/30, 01:23 PM`. A wall-clock
		* glued to "AM/PM" reads as 12-hour no matter what the surrounding UI assumes,
		* and it is the one thing a Chinese user cannot scan past — the card otherwise
		* speaks 24-hour everywhere (see `formatClock`).
		*
		* `h23` rather than `hour12: false`, because the latter maps to `h24` in some
		* engines and would print midnight as `24:00`. `h23` pins 00–23 exactly, which
		* is also the cycle DSH's own timestamps use.
		*/
		function formatShort(value) {
			return new Intl.DateTimeFormat(void 0, {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23"
			}).format(new Date(value));
		}
		function formatClock(value) {
			return new Intl.DateTimeFormat(void 0, {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
				hourCycle: "h23"
			}).format(new Date(value));
		}
		/** A dot colour for one account's state. */
		function stateColor(account) {
			if (account.excludedBy !== void 0) return account.excludedBy === "rate-limited" || account.excludedBy === "unavailable" ? "var(--dsw-alias-state-warn-primary, #f59e0b)" : "var(--dsw-alias-state-error-primary, #ef4444)";
			if (account.probe === void 0) return "var(--dsw-alias-label-dimmed, #9aa0a6)";
			return outcomeOk(account.probe.outcome) ? "var(--dsw-alias-state-success-primary, #22a06b)" : "var(--dsw-alias-state-warn-primary, #f59e0b)";
		}
		/** The exclusion label for one account, or undefined when it is usable. */
		function exclusionText(t, account) {
			switch (account.excludedBy) {
				case "rate-limited": return t("row.poolExcludedRateLimited");
				case "out-of-credit": return t("row.poolExcludedOutOfCredit");
				case "credential-rejected": return t("row.poolExcludedRejected");
				case "not-found": return t("row.probeNotFound");
				case "unavailable": return t("row.probeUnavailable");
				case "failed": return t("row.probeFailed");
				case "unusable": return t("row.poolExcludedUnusable");
				default: return;
			}
		}
		/**
		* The pool section.
		*
		* Renders nothing when the Host reports no pool state at all: an older Host
		* built without this feature should show an unmodified card, not an empty
		* section implying the feature exists.
		*/
		function AccountPool(props) {
			const { t, region, pool, settingsScope, siblingBusy, onBusyChange, onSaved, onRefresh, onRescan, rescanning, onSelectAccount, selectingAccount } = props;
			const [draft, setDraft] = (0, react.useState)(null);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(void 0);
			const [busy, setBusy] = (0, react.useState)(void 0);
			const [actionError, setActionError] = (0, react.useState)(void 0);
			const [log, setLog] = (0, react.useState)(() => logStore.get(region) ?? []);
			(0, react.useEffect)(() => {
				setLog(logStore.get(region) ?? []);
			}, [region]);
			const [draftRegion, setDraftRegion] = (0, react.useState)(void 0);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const saved = {
				enabled: pool?.enabled ?? false,
				targetModelId: pool?.targetModelId || pool?.staleTargetModelId || "",
				probeInputTokens: pool?.probeInputTokens ?? 0,
				memberAccountIds: pool?.memberAccountIds ?? []
			};
			const active = draftRegion === region && draft !== null ? draft : saved;
			const dirty = draftRegion === region && draft !== null && (draft.enabled !== saved.enabled || draft.targetModelId !== saved.targetModelId || draft.probeInputTokens !== saved.probeInputTokens || !sameIds(draft.memberAccountIds, saved.memberAccountIds));
			/**
			* Membership that actually resolves to a local sign-in — what a batch runs on.
			*
			* The HOST computes this and sends it, so the card cannot drift from the
			* batch's real behaviour. Counting the raw saved list is what let the UI
			* claim "已选 1 / 共 1" and enable both buttons while the batch ran on ZERO
			* accounts and reported success.
			*
			* Derived locally as a FALLBACK for the case where the user has edited the
			* draft (the Host's answer describes the SAVED state) or an older Host omits
			* the field.
			*/
			const listedIds = new Set((pool?.accounts ?? []).map((account) => account.accountId));
			const effectiveMembers = effectiveMemberIds({
				savedEffective: pool?.effectiveMemberAccountIds ?? [],
				draftMembers: active.memberAccountIds,
				listedIds,
				dirty
			});
			/** Saved ids with no matching sign-in; surfaced rather than silently ignored. */
			const ghostMembers = ghostMemberIds(active.memberAccountIds, listedIds);
			/**
			* Pool MEMBERS that can serve right now.
			*
			* Judged over members only. Using the whole account table made the "no usable
			* account" warning unreachable: unchecked rows are listed for the user to opt
			* into and never carry `excludedBy`, so any unchecked sign-in kept the count
			* above zero — exactly when every member was limited and the explanation was
			* most needed.
			*/
			const usableMemberSet = new Set(usableMemberIds(pool?.accounts ?? [], effectiveMembers, active.memberAccountIds));
			const usable = (pool?.accounts ?? []).filter((account) => usableMemberSet.has(account.accountId));
			const canEditPool = settingsScope !== void 0;
			(0, react.useEffect)(() => {
				onBusyChange?.(saving);
				return () => {
					onBusyChange?.(false);
				};
			}, [onBusyChange, saving]);
			const appendLog = (0, react.useCallback)((text, tone) => {
				setLog((previous) => {
					const next = [{
						atMs: Date.now(),
						text,
						tone
					}, ...previous].slice(0, LOG_LIMIT);
					logStore.set(region, next);
					return next;
				});
			}, [region]);
			/**
			* The latest saved preferences, for callbacks that must not capture a stale
			* copy.
			*
			* `saved` is rebuilt on every render, so putting it in a `useCallback` dep
			* list would rebuild the callback every render (making the memo pointless),
			* while listing individual fields by hand is exactly what caused the
			* data-loss defect this ref fixes: a field added later
			* (`memberAccountIds`) was missing from the list, so the callback kept a
			* stale base and checking one account silently dropped another.
			*
			* A ref gives both properties at once — a STABLE callback identity and a
			* base read at call time. It is synced in a LAYOUT effect, which flushes
			* synchronously after commit and BEFORE the browser paints: a user event
			* cannot be processed before a frame is painted, so by the time any click
			* reaches `editDraft` the ref is current. (A plain `useEffect` would leave a
			* window between paint and its flush; a render-phase write would be unsafe
			* under concurrent rendering, where a discarded pass could leave the ref
			* holding values from a tree that never committed.)
			*
			* Seeded with the initial value so the very first interaction, before any
			* effect has run, still reads real preferences.
			*/
			const savedRef = (0, react.useRef)(saved);
			(0, react.useLayoutEffect)(() => {
				savedRef.current = saved;
			});
			/** Read by `editDraft` so it can refuse edits mid-save without rebuilding. */
			const savingRef = (0, react.useRef)(saving);
			(0, react.useLayoutEffect)(() => {
				savingRef.current = saving;
			});
			const editDraft = (0, react.useCallback)((edit) => {
				if (savingRef.current) return;
				setDraftRegion(region);
				setDraft((previous) => {
					return edit(draftBaseFor(previous, draftRegion, region, savedRef.current));
				});
			}, [draftRegion, region]);
			const discard = (0, react.useCallback)(() => {
				setDraft(null);
				setDraftRegion(void 0);
				setSaveError(void 0);
			}, []);
			/** Save the pool preferences through the plugin's VERIFIED write path. */
			const save = (0, react.useCallback)(async () => {
				if (settingsScope === void 0 || !dirty || draft === null) return;
				setSaving(true);
				setSaveError(void 0);
				let committed = false;
				try {
					await writePoolPreferences(settingsScope, region, draft);
					if (await onSaved?.() === false) {
						if (mounted.current) setSaveError(t("row.poolSavedStaleRefresh"));
						return;
					}
					committed = true;
				} catch (error) {
					if (mounted.current) {
						const reason = error instanceof Error ? error.message : t("row.requestFailed");
						setSaveError(isFileContentionWriteError(error) ? `${reason}${t("row.saveContentionHint")}` : reason);
					}
				} finally {
					if (committed) discard();
					if (mounted.current) setSaving(false);
				}
			}, [
				dirty,
				discard,
				draft,
				onSaved,
				region,
				settingsScope,
				t
			]);
			/** Check or uncheck one account in this pool. */
			const toggleMember = (0, react.useCallback)((accountId, next) => {
				editDraft((current) => {
					const set = new Set(current.memberAccountIds);
					if (next) set.add(accountId);
					else set.delete(accountId);
					return {
						...current,
						memberAccountIds: [...set]
					};
				});
			}, [editDraft]);
			/** Check every listed account, or none of them. */
			const selectAll = (0, react.useCallback)((next) => {
				editDraft((current) => ({
					...current,
					memberAccountIds: next ? (pool?.accounts ?? []).map((account) => account.accountId) : []
				}));
			}, [editDraft, pool]);
			/** Run one batch action against the Host. */
			const runAction = (0, react.useCallback)(async (action) => {
				setBusy(action);
				setActionError(void 0);
				const memberCount = announcedBatchCount({
					savedEffective: pool?.effectiveMemberAccountIds,
					savedMembers: pool?.memberAccountIds ?? []
				});
				appendLog(action === "checkin" ? t("row.poolLogCheckinStart", { count: memberCount }) : t("row.poolLogTestStart", {
					count: memberCount,
					model: pool?.targetModelId ?? ""
				}), "info");
				/**
				* One test row into the activity log.
				*
				* Shared by the STREAMED shape (a line per account) and the whole-batch
				* shape (an older Host's single document), so the two can never report the
				* same measurement differently — the failure mode this file's history is
				* mostly made of.
				*/
				const logTestRow = (row) => {
					const outcome = row?.result?.outcome;
					if (outcome === void 0) {
						appendLog(t("row.poolLogTestRowMalformed", { accountName: row?.accountName === "" || row?.accountName === void 0 ? t("row.accountUnnamed") : row.accountName }), "warn");
						return;
					}
					appendLog(t("row.poolLogTestRow", {
						accountName: row.accountName === "" ? t("row.accountUnnamed") : row.accountName,
						outcome: outcomeText(t, outcome)
					}), outcomeOk(outcome) ? "ok" : "warn");
				};
				try {
					const response = await fetch(withWorkBuddyRegionAndAction(WORKBUDDY_POOL_PATH, region, action), {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					let failed = false;
					if ((response.headers.get("content-type") ?? "").includes("ndjson")) {
						if (!response.ok) throw new Error(poolFailureText(t, { status: response.status }));
						let sawRow = false;
						await readNdjson(response.body, (line) => {
							const row = line["row"];
							if (row !== void 0) {
								sawRow = true;
								if (mounted.current) logTestRow(row);
								return;
							}
							const reason = line["reason"];
							if (typeof reason === "string") {
								failed = true;
								const message = poolFailureText(t, {
									status: 200,
									reason,
									error: typeof line["error"] === "string" ? line["error"] : void 0
								});
								if (mounted.current) {
									setActionError(message);
									appendLog(t("row.poolLogBatchFailed", { message }), "error");
								}
							}
						});
						if (!mounted.current) return;
						if (!failed && sawRow) appendLog(t("row.poolLogTestDone"), "ok");
					} else {
						const body = await response.json().catch(() => void 0);
						if (!response.ok) throw new Error(poolFailureText(t, {
							status: response.status,
							reason: body?.reason,
							error: body?.error
						}));
						if (!mounted.current) return;
						if (action === "checkin") {
							for (const row of body?.rows ?? []) if (row.status === "claimed") appendLog(t("row.poolLogCheckinClaimed", {
								accountName: row.accountName === "" ? t("row.accountUnnamed") : row.accountName,
								credit: String(row.credit ?? 0)
							}), "ok");
							else if (row.status === "already") appendLog(t("row.poolLogCheckinAlready", { accountName: row.accountName === "" ? t("row.accountUnnamed") : row.accountName }), "info");
							else appendLog(t("row.poolLogCheckinFailed", {
								accountName: row.accountName === "" ? t("row.accountUnnamed") : row.accountName,
								message: row.message ?? t("row.requestFailed")
							}), "error");
							appendLog(t("row.poolLogCheckinDone"), "ok");
						} else {
							for (const row of body?.rows ?? []) logTestRow(row);
							appendLog(t("row.poolLogTestDone"), "ok");
						}
					}
					if (failed) return;
					onRefresh?.();
				} catch (error) {
					const message = error instanceof Error ? error.message : t("row.requestFailed");
					if (mounted.current) {
						setActionError(message);
						appendLog(t("row.poolLogBatchFailed", { message }), "error");
					}
				} finally {
					if (mounted.current) setBusy(void 0);
				}
			}, [
				appendLog,
				onRefresh,
				pool,
				region,
				t
			]);
			if (pool === void 0) return null;
			/**
			* Where the target model came from, and which model it is.
			*
			* Shown INSIDE the 「目标 test model」 setting row (as its description line)
			* rather than as a note under the buttons, which is where it used to be — one
			* of two places that stated the target model, the other being the header
			* subtitle. Both are gone from the header, so this is now the single place the
			* provenance is stated, right beside the control it describes.
			*
			* Returns null when there is nothing to say, so the caller can fall back to the
			* static explanation instead of rendering an empty "current:" prefix.
			*/
			const targetProvenance = pool.targetModelSource === "preferred" ? t("row.poolTargetCurrentPreferred", { model: pool.targetModelId ?? "" }) : pool.targetModelSource === "free" ? t("row.poolTargetCurrentFree", { model: pool.targetModelId ?? "" }) : pool.targetModelSource === "stale" ? t("row.poolTargetStale", { model: pool.staleTargetModelId ?? "" }) : pool.targetModelSource === "none" ? t("row.poolTargetNone") : null;
			/**
			* The account the next request will start from.
			*
			* Read from the Host's `current` flag rather than re-derived here: the Host
			* owns the selection, and a browser-side guess is how the card would start
			* disagreeing with the account actually billed.
			*/
			const currentAccount = pool.accounts.find((account) => account.current);
			const currentName = currentAccount === void 0 ? void 0 : currentAccount.accountName === "" ? t("row.accountUnnamed") : currentAccount.accountName;
			return (0, react.createElement)("section", { className: "dsm-workbuddy-pool" }, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-head" }, (0, react.createElement)("h3", { className: "dsm-workbuddy-pool-title" }, t("row.poolTitle")), currentName === void 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-current-badge" }, t("row.poolCurrentHeader", { account: currentName }))), !active.enabled && onSelectAccount !== void 0 && pool.accounts.length > 0 ? (0, react.createElement)("div", { className: "dsm-workbuddy-pool-set" }, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-set-copy" }, (0, react.createElement)("b", null, t("row.poolManualAccountLabel")), (0, react.createElement)("span", null, t("row.poolManualAccountHint"))), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-set-ctl" }, (0, react.createElement)("select", {
				className: "dsm-workbuddy-pool-select dsm-workbuddy-pool-account-select",
				value: currentAccount?.accountId ?? "",
				disabled: selectingAccount === true,
				onChange: (event) => {
					onSelectAccount(event.currentTarget.value);
				}
			}, pool.accounts.some((account) => account.current) ? null : (0, react.createElement)("option", {
				value: "",
				disabled: true
			}, t("row.poolManualAccountNone")), ...pool.accounts.map((account) => (0, react.createElement)("option", {
				key: account.accountId,
				value: account.accountId
			}, account.accountName === "" ? t("row.accountUnnamed") : account.accountName))))) : null, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-actions" }, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-actions-group" }, pool.checkinSupported ? (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-primary",
				disabled: busy !== void 0 || effectiveMembers.length === 0,
				onClick: () => {
					runAction("checkin");
				}
			}, busy === "checkin" ? t("row.poolCheckingIn") : t("row.poolCheckinAll")) : null, (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline",
				disabled: busy !== void 0 || effectiveMembers.length === 0 || pool.targetModelSource === "none" || pool.targetModelSource === "stale",
				title: pool.targetModelSource === "none" ? t("row.poolTargetNone") : pool.targetModelSource === "stale" ? t("row.poolTargetStale", { model: pool.staleTargetModelId ?? "" }) : void 0,
				onClick: () => {
					runAction("test");
				}
			}, busy === "test" ? t("row.poolTesting") : t("row.poolTestAll")), busy === void 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-hint" }, t("row.poolBusyHint"))), onRescan === void 0 ? null : (0, react.createElement)("div", { className: "dsm-workbuddy-pool-actions-group" }, (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline",
				disabled: rescanning === true,
				onClick: onRescan
			}, rescanning === true ? t("row.accountsScanning") : t("row.accountsRescan")))), !active.enabled ? (0, react.createElement)("p", { className: "dsm-workbuddy-pool-note" }, t("row.poolEnabledHint")) : null, active.enabled && usable.length === 0 ? (0, react.createElement)("p", {
				className: "dsm-workbuddy-pool-warn",
				role: "status"
			}, `${t("row.poolNoCandidate")} ${t("row.poolNoCandidateHint")}`) : null, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-members" }, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-members-head" }, (0, react.createElement)("div", null, (0, react.createElement)("h4", { className: "dsm-workbuddy-pool-members-title" }, t("row.poolMembersTitle")), (0, react.createElement)("p", { className: "dsm-workbuddy-pool-note" }, t("row.poolMembersHint"))), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-members-actions" }, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-hint" }, t("row.poolSelectedCount", {
				count: effectiveMembers.length,
				total: pool.accounts.length
			})), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline dsm-workbuddy-pool-small-btn",
				disabled: pool.accounts.length === 0 || !canEditPool,
				onClick: () => selectAll(true)
			}, t("row.poolSelectAll")), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline dsm-workbuddy-pool-small-btn",
				disabled: effectiveMembers.length === 0 || !canEditPool,
				onClick: () => selectAll(false)
			}, t("row.poolSelectNone")))), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-table" }, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-row dsm-workbuddy-pool-row-head" }, (0, react.createElement)("span", null, t("row.poolColumnAccount")), (0, react.createElement)("span", null, t("row.poolColumnCredits")), (0, react.createElement)("span", null, t("row.poolColumnProbe")), pool.checkinSupported ? (0, react.createElement)("span", null, t("row.poolColumnCheckin")) : null), ...pool.accounts.map((account) => renderAccountRow({
				t,
				account,
				checked: active.memberAccountIds.includes(account.accountId),
				canEdit: canEditPool,
				checkinSupported: pool.checkinSupported,
				onToggle: (next) => toggleMember(account.accountId, next)
			}))), effectiveMembers.length === 0 ? (0, react.createElement)("p", {
				className: "dsm-workbuddy-pool-warn",
				role: "status"
			}, `${t("row.poolNoneSelected")} ${t("row.poolNoneSelectedHint")}`) : null, ghostMembers.length === 0 ? null : (0, react.createElement)("p", {
				className: "dsm-workbuddy-pool-warn",
				role: "status"
			}, t("row.poolGhostMembers", { count: ghostMembers.length })), dirty && !sameIds(active.memberAccountIds, saved.memberAccountIds) ? (0, react.createElement)("p", { className: "dsm-workbuddy-pool-dirty" }, t("row.poolUnsavedMembers")) : null), pool.targetModelSource === "none" ? (0, react.createElement)("p", {
				className: "dsm-workbuddy-pool-warn",
				role: "status"
			}, `${t("row.poolTargetNone")} ${t("row.poolTargetNoneHint")}`) : null, pool.targetModelSource === "stale" ? (0, react.createElement)("div", { className: "dsm-workbuddy-pool-conflict" }, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-conflict-main" }, (0, react.createElement)("b", null, t("row.poolTargetStale", { model: pool.staleTargetModelId ?? "" })), (0, react.createElement)("span", null, t("row.poolTargetStaleHint"))), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline",
				disabled: !canEditPool,
				onClick: () => {
					editDraft((current) => ({
						...current,
						targetModelId: ""
					}));
				}
			}, t("row.poolTargetStaleClear"))) : null, actionError === void 0 ? null : (0, react.createElement)("p", {
				className: "dsm-workbuddy-pool-error",
				role: "alert"
			}, actionError), renderSettings({
				t,
				pool,
				active,
				dirty,
				saving,
				siblingBusy: siblingBusy === true,
				saveError,
				settingsScope,
				onEdit: editDraft,
				onSave: () => {
					save();
				},
				onDiscard: discard,
				appendLog,
				targetProvenance
			}), (0, react.createElement)("p", { className: "dsm-workbuddy-pool-note" }, t("row.poolRegionNote")), renderLog({
				t,
				log,
				busy: busy !== void 0,
				onClear: () => {
					logStore.set(region, []);
					setLog([]);
				}
			}));
		}
		/** One account's row. */
		function renderAccountRow(input) {
			const { t, account, checked, canEdit, checkinSupported, onToggle } = input;
			const name = account.accountName === "" ? t("row.accountUnnamed") : account.accountName;
			const excluded = exclusionText(t, account);
			const probe = account.probe;
			const outcomeLine = probe === void 0 ? t("row.poolNeverTested") : probe.retryAtMs !== void 0 ? `${outcomeText(t, probe.outcome)} · ${t("row.poolRetryAt", { at: formatShort(probe.retryAtMs) })}` : probe.outcome === "rate-limited" || probe.outcome === "out-of-credit" ? `${outcomeText(t, probe.outcome)} · ${t("row.poolRetryUnknown")}` : outcomeText(t, probe.outcome);
			const remaining = probe?.retryAtMs === void 0 ? "" : remainingText(t, probe.retryAtMs, Date.now());
			const reason = probe === void 0 ? void 0 : inlineProbeReason(probe.outcome, probe.message);
			const age = probe === void 0 ? void 0 : probeAgeText(t, probe.atMs, Date.now());
			const probeLabel = probe === void 0 ? void 0 : probe.source === void 0 ? {
				text: t("row.poolProbeSourceUnknown"),
				className: "dsm-workbuddy-pool-prov-tag dsm-workbuddy-pool-prov-unknown"
			} : probe.source === "live-request" ? {
				text: t("row.poolProbeSourceLive"),
				className: "dsm-workbuddy-pool-prov-tag dsm-workbuddy-pool-prov-live"
			} : {
				text: t("row.poolProbeSourceTest"),
				className: "dsm-workbuddy-pool-prov-tag"
			};
			const probeLine = [
				outcomeLine,
				remaining,
				reason
			].filter((part) => part !== void 0 && part !== "").join(" · ");
			return (0, react.createElement)("div", {
				className: `dsm-workbuddy-pool-row${account.current ? " dsm-workbuddy-pool-row-current" : ""}`,
				key: account.accountId
			}, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-account" }, (0, react.createElement)("label", { className: "dsm-workbuddy-pool-check" }, (0, react.createElement)("input", {
				type: "checkbox",
				checked,
				disabled: !canEdit,
				"aria-label": t("row.poolSelectAria", { accountName: name }),
				onChange: (event) => onToggle(event.currentTarget.checked)
			})), (0, react.createElement)("span", {
				className: "dsm-workbuddy-usage-dot",
				style: { background: stateColor(account) }
			}), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-account-name" }, (0, react.createElement)("b", null, name), account.current ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-current-tag" }, t("row.poolCurrentBadge")) : null, (0, react.createElement)("span", { className: checked ? "dsm-workbuddy-pool-member" : "dsm-workbuddy-pool-not-member" }, checked ? t("row.poolMember") : t("row.poolNotMember")), excluded === void 0 ? probe === void 0 ? null : (0, react.createElement)("span", null, t("row.poolTestedAt", { at: formatShort(probe.atMs) })) : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-excluded" }, excluded))), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-credits" }, account.credits === void 0 ? (0, react.createElement)("span", null, "—") : (0, react.createElement)("b", null, formatNumber$1(account.credits)), account.expiringSoon !== void 0 && account.expiringSoon > 0 ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-soon" }, t("row.poolCreditSoon", { count: formatNumber$1(account.expiringSoon) })) : account.nearestExpiryMs === void 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-soon-plain" }, t("row.poolCreditNearest", { at: formatShort(account.nearestExpiryMs) }))), (0, react.createElement)("span", {
				className: "dsm-workbuddy-pool-probe",
				...probe?.message === void 0 ? {} : { title: probe.message }
			}, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-probe-main" }, probeLine), probeLabel === void 0 && age === void 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-probe-prov" }, probeLabel === void 0 ? null : (0, react.createElement)("span", { className: probeLabel.className }, probeLabel.text), probeLabel === void 0 || age === void 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-prov-sep" }, "·"), age === void 0 ? null : (0, react.createElement)("span", { className: "dsm-workbuddy-pool-prov-age" }, age))), checkinSupported ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-checkin" }, account.checkedInToday === void 0 ? (0, react.createElement)("span", {
				className: "dsm-workbuddy-pool-unknown",
				title: t("row.poolNeverTested")
			}, t("row.poolCheckinUnknown")) : account.checkedInToday ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-checked" }, t("row.poolCheckedIn")) : t("row.poolNotCheckedIn")) : null);
		}
		/** The preference editor plus its save/discard actions. */
		function renderSettings(input) {
			const { t, pool, active, dirty, saving, siblingBusy, saveError, settingsScope, onEdit, onSave, onDiscard, targetProvenance } = input;
			const canEdit = settingsScope !== void 0;
			const toggle = (label, hint, checked, onChange, disabled = false) => (0, react.createElement)("div", { className: "dsm-workbuddy-pool-set" }, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-set-copy" }, (0, react.createElement)("b", null, label), (0, react.createElement)("span", null, hint)), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-set-ctl" }, (0, react.createElement)("label", { className: "sw" }, (0, react.createElement)("input", {
				type: "checkbox",
				checked,
				disabled: disabled || !canEdit,
				onChange: (event) => onChange(event.currentTarget.checked)
			}), (0, react.createElement)("span", { className: "sw-track" }))));
			return (0, react.createElement)("div", { className: "dsm-workbuddy-pool-settings-wrap" }, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-head" }, (0, react.createElement)("h3", { className: "dsm-workbuddy-pool-title" }, t("row.poolSettingsTitle")), dirty ? (0, react.createElement)("span", { className: "dsm-workbuddy-pool-dirty" }, t("row.poolDirty")) : null), (0, react.createElement)("p", { className: "dsm-workbuddy-pool-note" }, t("row.poolSettingsHint")), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-settings" }, toggle(t("row.poolEnabled"), t("row.poolEnabledHint"), active.enabled, (next) => onEdit((current) => ({
				...current,
				enabled: next
			}))), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-set" }, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-set-copy" }, (0, react.createElement)("b", null, t("row.poolTargetLabel")), (0, react.createElement)("span", null, targetProvenance === null ? null : `${targetProvenance} `, t("row.poolTargetHint"))), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-set-ctl" }, (0, react.createElement)("select", {
				className: "dsm-workbuddy-pool-select",
				value: active.targetModelId,
				disabled: !canEdit,
				onChange: (event) => {
					const value = event.currentTarget.value;
					onEdit((current) => ({
						...current,
						targetModelId: value
					}));
				}
			}, (0, react.createElement)("option", { value: "" }, t("row.poolTargetAutoOption")), active.targetModelId !== "" && !(pool.catalog ?? []).some((m) => m.id === active.targetModelId) ? (0, react.createElement)("option", {
				value: active.targetModelId,
				disabled: true
			}, t("row.poolTargetStaleOption", { model: active.targetModelId })) : null, ...(pool.catalog ?? []).map((model) => (0, react.createElement)("option", {
				value: model.id,
				key: model.id
			}, model.creditMultiplier === void 0 ? model.name : `${model.name} (x${model.creditMultiplier.toFixed(2)})`))))), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-set" }, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-set-copy" }, (0, react.createElement)("b", null, t("row.poolProbeSizeLabel")), (0, react.createElement)("span", null, t("row.poolProbeSizeHint"))), (0, react.createElement)("span", { className: "dsm-workbuddy-pool-set-ctl" }, (0, react.createElement)("select", {
				className: "dsm-workbuddy-pool-select",
				value: String(active.probeInputTokens),
				disabled: !canEdit,
				onChange: (event) => {
					const parsed = Number.parseInt(event.currentTarget.value, 10);
					const next = Number.isFinite(parsed) ? parsed : 0;
					onEdit((current) => ({
						...current,
						probeInputTokens: next
					}));
				}
			}, (0, react.createElement)("option", { value: "0" }, t("row.poolProbeSizeDefault")), ...PROBE_INPUT_TOKEN_CHOICES.map((tokens) => (0, react.createElement)("option", {
				value: String(tokens),
				key: String(tokens)
			}, t("row.poolProbeSizeOption", { tokens: String(tokens / 1e3) }))))))), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-save-bar" }, (0, react.createElement)("a", {
				className: "dsm-workbuddy-usage-cheer",
				href: WORKBUDDY_GITHUB_URL,
				target: "_blank",
				rel: "noopener noreferrer"
			}, t("row.cheer"), (0, react.createElement)("span", {
				className: "dsm-workbuddy-usage-cheer-star",
				"aria-hidden": "true"
			}, "★")), (0, react.createElement)("div", { className: "dsm-workbuddy-pool-save-buttons" }, (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline",
				disabled: !dirty || saving || siblingBusy,
				onClick: onDiscard
			}, t("row.poolDiscard")), (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-primary",
				disabled: !dirty || saving || siblingBusy || !canEdit,
				onClick: onSave
			}, saving ? t("row.poolSaving") : t("row.poolSaved")))), saveError === void 0 ? null : (0, react.createElement)("p", {
				className: "dsm-workbuddy-pool-error",
				role: "alert"
			}, t("row.poolSaveFailed", { message: saveError })));
		}
		/** The activity log. */
		function renderLog(input) {
			const { t, log, busy, onClear } = input;
			return (0, react.createElement)("div", { className: "dsm-workbuddy-pool-log" }, (0, react.createElement)("div", { className: "dsm-workbuddy-pool-log-head" }, (0, react.createElement)("span", null, t("row.poolLogTitle")), log.length === 0 ? null : (0, react.createElement)("button", {
				type: "button",
				className: "dsm-btn dsm-btn-outline dsm-workbuddy-pool-log-clear",
				disabled: busy === true,
				onClick: onClear
			}, t("row.poolLogClear"))), log.length === 0 ? (0, react.createElement)("div", { className: "dsm-workbuddy-pool-log-empty" }, t("row.poolLogEmpty")) : (0, react.createElement)("div", { className: "dsm-workbuddy-pool-log-body" }, ...log.map((entry, index) => (0, react.createElement)("div", {
				className: "dsm-workbuddy-pool-log-row",
				key: `${entry.atMs}-${index}`
			}, (0, react.createElement)("span", { className: "dsm-workbuddy-pool-log-time" }, formatClock(entry.atMs)), (0, react.createElement)("span", { className: `dsm-workbuddy-pool-log-text dsm-workbuddy-pool-log-${entry.tone}` }, entry.text)))));
		}
		//#endregion
		//#region src/native-modality.ts
		/**
		* Reviewed vendor classifications, keyed by EXACT model id (never a prefix).
		* Ids absent from this record are `unknown` — see {@link nativeModalityOf}.
		*/
		const NATIVE_MODALITY_BY_MODEL_ID = {
			"deepseek-v4-pro": "text",
			"glm-5.1": "text",
			"glm-5.2": "text",
			"glm-5.3": "text",
			"hy3": "text",
			"hy4-preview": "text",
			"deepseek-v4.1-flash": "multimodal",
			"glm-5.3-flash": "multimodal",
			"glm-5v-turbo": "multimodal",
			"kimi-k2.6": "multimodal",
			"kimi-k2.7": "multimodal",
			"kimi-k3-1": "multimodal",
			"minimax-m3": "multimodal"
		};
		/** The `auto` entry is a router that picks a model, not a model itself. */
		const ROUTER_MODEL_ID = "auto";
		/**
		* Native modality of one model id. Exact match only: a new model never
		* inherits a classification from its family, its display name, or the
		* platform's image flag.
		*/
		function nativeModalityOf(modelId) {
			if (modelId === ROUTER_MODEL_ID) return "router";
			return NATIVE_MODALITY_BY_MODEL_ID[modelId] ?? "unknown";
		}
		/**
		* Whether a model refresh should PRE-CHECK this model's image box.
		*
		* Only a documented `multimodal` is pre-checked. `text` is documented as
		* unable to read images, and `unknown` is deliberately left unchecked rather
		* than guessed — the whole reason this table exists is that the platform flag
		* guessed wrong. A platform `supportsImages: false` still vetoes, so a
		* documented-multimodal id can never be pre-checked against the platform's
		* explicit "no".
		*
		* The user can always tick a box by hand; this decides a DEFAULT only, and the
		* effective runtime flag remains the saved `imageModelIds`.
		*/
		function imageDefaultFor(info) {
			if (info.supportsImages === false) return false;
			return NATIVE_MODALITY_BY_MODEL_ID[info.id] === "multimodal";
		}
		//#endregion
		//#region src/client/icon.ts
		/**
		* Plugin icon (LD brand logo, 64px) shared across the LaoDing plugin family.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — 同一 data URI，其注释说明来自
		*     dingminhua/dsh-subagent-default-model（MIT），用于让插件家族的
		*     外观保持一致。本项目沿用同一图标以达到同样目的。
		* 改动：无。
		*
		* @module dsh-connect-workbuddy/client/icon
		*/
		const WORKBUDDY_PLUGIN_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAXGUlEQVR4nH1bC7BdVXn+1tr7nHPvzb3JvUloSAQp0JHWoAMttKOCFrWU8irQSbCTQYG21IahnTJUUTsM0FJhZCzCSIcKImOpDkhrhQ5YC7ROB3lUBU3EyCuBFBIIedzcx3ntvTr/a621TwIns3PO3mfvddf/+v7v/9c6DvYKoYBz1cZNYfJpVBcNBm7dcIhj3TBM15VzqAE6XAWEGggVADroOl0byDW+PtRr9E732rl9r2PxOMNsrCogVE7PA0Kge4Lcz5/TGI6v00UaK+h98u4QUA9quIDg4Pe2i2LTsknc++mzZu9cv37VHNaFAveSJICj/9aFUNzrXHXSTwdnznl/Y+X9MaEP1D0A/ToKaUdDASoAK0YVYcLad/G88S6C1aQcOkI2Nj9HylBFBRMYqPUeFp6EDXQfKcIUoud6LQQP59rwrsBEOdhy9KGDK/7j9mUPmBKcCf++Z4YbF6eKLw+6QFioKl/DoYILlXMsHE2KPCCzwlsqoNb3oUw4Kq+2a0k4G4MtXOX3J4HNyulzUkC0eqYI8ZAaQZQSAh9080Qx1m7jHStnL/3B3ctvXbcuFOwBH/p5OG12DA/29leV6wcHeI8hadE1rBldl/6ACs7WMEuz0PIcKawe0Gdzeyf36eTzcOHxVAEpTEQB0QtY0PRZPMYsX+t3tSqBxkteYeHh6qqu6yIsmVhaHHtE7/fu/8fJhzzF/OywunXQR+DJOO9pkLp2NJ64pIXhaOxb/IfmJM29PemSJ+NSzJP1s2dhwmucJ6uaoIYFzVjnkFDhLRTkb2XC03gQTKDrZNjSV1icXwzPv9y99Z5Hw6R/psQnqoniyLBQ1d65IoGiDqZuHwWwzyFzx8xl5RDBZR4uCZc9E8fS+8TdSfHZ2KxAel6VwEIYZiflxC9NKToeKcKrAcjV2d2DK3xYqOcXJ478ytf2fcL3htWGegAaSZGeBnKixWgVPXRiZpEomLq4Kcri2RCc7zN3NWuq5XlOJLwqjq9liqlHlEfzSveIdVk0Fjh5kVjdjKLneniCtcEg7N492FBWAWvrHpwLzgmYUfySi+VorcJFBE6I7jIAjFnC3DybePKE5ClxLLsPI0q3kNAsYJ4g1wjkzDuju4nQJrx6RxRe/7YHfFX3MOyHtaUHloaKcqa4rcQTDWxubHnZ0lESNoaGXad7+RmLc7GMxbS4s8Y82S3mdhMshR+Po4pk181jkx22afHc8hL3plNTjOGDjEfu7pxfWkpcyA02Ofo6xpylPsMCi3eNTROShVawM0H4+4bXaGqzcTKQzc8j6VGPkb9tFtU56bwlBdK9ZMQMKNgolMtVKepFcq6hBMAzQJAQ6srG9iwNJRfN0LtWd64z1qZjRPDieBYQkyNTqFpCsoYoKQFoFt8xhA5icZ2fXWOwY4GScsT95Tv7XoSnd0ehgLJBSPSdkdhYWbSeAk2eCSzuScDs/qQo9dpRZarVWWm5ZRuxn8YRRabYtiwhn5PVRXD9js8FzM2rowKII7MnOJSR2GSZJMVUckfzjIjKMe2p5fOsENGfPESR38AwB8AsZTUBUV025TwWVEAsubSl6gYA8rU6eUMmvE2ErjMrQEDZQGkewGI6TcqPAhlT1hHBBV0xZC/R3B09JFmdXDESrIz5GRPMlWQA6kNAoVbjf7FAyq1vsW8xrt+rImI4aEiwIuqAMjI9y/8Z5RSAS+f04P4uTcihozDLaO6kZup2gSWFIXjm3plb75sHxkugMKzAgWmQcYmsTvqrgPkuMOgHFAhY0gnolDJfOgTM0t/xMcYTJeZz9QZRgHiUd5AQIHe2fNqIY3o4xiEw3wc++A6HvzweWNbWtKmsrF853PFEwDd/LEqoVOiYQQLQ7QGXn+Zw3okOhc9i1tw8umpS7mBQ4PW9Ab/YVuHxTTV+8EyF7TsqTHQCxtsBlVWSUVBViGYHcnMDQvaUyAv03wmPDcP8ECiy2lwOKl4CFz2+AoYDx1b73rkOayaVfUXziRMu9oGTbg54cz9pNlV9FEJzi8CJv+zwwOWWoZvZfXSst3rteDPgXx4e4LZv9fDS9grLlzotkclDakmXJCCFTswAdC5eZQqphwErZgr40QInAh4XHMbsHGt6ugSmWuLZwyqwlclFhwqOrSJgZky+izydc7bj+1ZPy7P9AT2nz/MR+PuK/g6/50fg8QdDGffQFQ4b13fwyFcmccl5HczOUgVYoXTcAGEBSWBzdRY4hoLUBvGeQGFgrM84gMWglq/mwszXqcSlAahgdi57l8/Mr9gaxiqbnZwheZMU23Lw88zN0zWff5ZzCpeyAApqTNWkjBorljnceMUEbvnMEqK0qIc1A6UAnYQS5/6Md4jTNxlhGUkKRYYBHmHCiEewJxQjzmmenFdphiXsZ0aKstogvmwkEiqwYml6MmS6kQkQKcUlICsIY6hyDAEbzupgZgr448/OouyI5Y3t8YgGfq5OIaHfeiZDWXclFizWw1OmF0lRQ4A8UWevnPTEsTNFjoQ7fV0UDq3SoSyBVgmU/FmOVsuz9VmfrCUBMPIMut4f1Dj9tzv4wqcmORzIvW1qwgOcYIC5vB0gzAClQW1EGuJXkgql2MlyuTHFhg4OAlrm8vRxtHrMFUhRV4trv/hawK3fqbF/QSwoYwSUPuCwlcDJ7y3wgeMKFHAYDgN7gOmwLBwGgxobzhnH/z7Txz9/exErpz2HK1teUZ+tTSGXZYZCFGAc3eqBZsESmZs1L0e92HK5TikSKA2N2CMY8QATfuvOgLOvqrBlW0CnyOioeWVF1/v4rXd7/M2fjeGEtQWGFO+FpkzFFPKOv/7zKXz/sR5m99foUJ2rRRNhhwCfAqBOxQkbVObHKSv14UZb2KnFdBAl5CdxvMwDcnotrTsW/vW9wPnXVdi2M+DwQ4DVK4CZSWDFVDp+aRkwNR7wxE8GOOuyWdz3vT7K0jMGyN8ToKTzFTMel2yYwPxcAJe56voR/eO7tOscY0Ls2GSFkJW+Nue8QTn6agJD6gta5mhwf7mHhCdesOGGCpu3AmMthzv+qsTHf6fArj0SP5YGKXNQZpleArRcjU9ePYdHnxgwPrAStK1EXkBhvO7scRx+aIleL2SWTzFP1qdQYkCs6dx66COob/28mB61GjzACwhmc9Q2rxnt/9GfUGwY1g4XfbHG488GjLWAmzYWOOU4zwAoKG6KteYG8YSAdunQKQM+dcMc9uwLbHnRv9Baumf5dIGPnNTB4jx5gQjNgisNLuH0Gr07ygKpjpdKsFnWGiuMXtLwfaPDpoRk/dFqjcYht6Q7P3lzhQefqvn87y4usOEjkgpjYlHhyT2psjMLErOcHANe3DbAXfd1xfUZVzRH6qMf/VA7E15JkfECdX9TiB+11ughDcisQGr4+wEfDqzrtegRxAau+aca3/gvEejK8z0uOcNhsUfWtAJGviOhrWKLXRwujgImx4Fvf3cR3V7gLGBRyDnfBbxnbQurVlImqJlEmdtLSpS/I9dACpD0l+I+sTjLCNbLe3sekHlEJry5/tJxh/98usZtDwo1vfTsAp/+mMeA0hrnPssalgl0PtoEEUYn18fbDltfHmLzlgEcs0MtiZ0oY+UKjyPWlBj0lRVGy3s+J2VQreKZIGUWq7MFDMEBaW01yMyoC7iRwmikG0zaZo5BcTwE9s0FXPS7Hp+/2DO356rQquKsvy9NDWV2yuXlM4Eb0O8FbN4ieTnCheIAKWLNao9qKPm/gJdD6bfhQkHlMLE9QmouF7Mlq1geM/hpO2xU/oNciT2K2B0Wik1/cHYu4Jz3O9y80bNXCOAJfnCzRAeguUhxbF0e7eLwMyIUKeW1HRkoWS9QXzPTnmWQvoOkQMED5Q8UDnDUE0ytLVv6jtbTyae6IP8T2qczNhKbAymLWP4nwXp94IhVDv9wWcGWoBRHHD/Fr8NPn6/Q8lpFpqCKwEgCGLsjF+4umOs3nZJeS8Y8ilrSHV0kazPqq6J5BRQylsgR4z2rALXhmWWkt8CAZvES49/aYDTZXsDxRzksnaDcTqAnz5DLtkqPux8c4LuPDTjfE9rnq0ziFUpotJfH4WFdjthUSbOjMdjFSXCtWg0EyyC9DU+fWcNq6UaDMq7tExJn6fFt3J+vKmPkZog9p4wqhoc6Dwvf8vjOfw9w+RcXucNj7e+0kpPa4wZmHDg1sHK5FAVCBXRgndb8XB2boj4TmBkgW9+AsLIOr/X6m/TX1uxjiyz3AOvjNQODMcVqb1GKrtrQ83qRQoCEf+SpITbeQJsSrLcnbhOR2zVZnBU0pXc46ghRAI+phMzGf3NnjRYBLOEPK8DzOxMheqcqFF5DIF+dyRZIYkhEgpJiNmn7wGIokhlLXWzNlEeHKvyTm4f4o+sWsdgNWHuUx2RHlG2KYDfniSaGyIUMMb4Zz/k+F5pGpyKp263x6v9VaBOztNyv40RmqGsG3o30+SMQZvXBAQsdb/UaJVTRdaVHZ2sPY22HzS9WuPDaLnbuqnHWySUe+vIU/uCjbcxRIUPpylKfeQMjuLTHF+drHH9sC2tWlxxGRKJiFADY/nKFXTsqjLUpE2jsx3Qq6C8A6CQEuP2V1wCNNfpmamvG/wg6amzLOmESPh+D0P7FVwMuuHoRW7dXOP19JW79zDjaLWBqQsLGipXo9jpZa2tTuG742EQmtKZSpcU/+VEf3fmANhVDbHnJGpEa8zUnxVK+o8N4fFx/H2F/MSXl3VvrBzhqUUmIJHdNedyAcfvrARdc08WzL9U4+bgSt181jjEFP1tljiVsrOHFAzothz27a5xx6jhOfn8HVUVU12YkvUR6/c/DPXQKEi4VPkyIuDrMiqNA3pbz/tGV29j3N68QetLweWuKKEOjdjMpsMX8Sb6nt2VLgCd/VuHMK4Z44ZUK7z26wJ1Xj2N6ynGKHOvYjhR6XumrKpFkbBfAnjcrrD2mhc9dORXpb5wJhULh8dzPB9j0wwEmlxDZMM9JyC9VoGQmz7wgU0Bc089dfqRCPKApqqsutCRGrarTf8PhjT0Bu2cDdu8L2LOvxu69AbP7A3a8UeEXWyu86zCPr187jjWHNFtclvqoFUZkiRRKf6/fDdj1eoXf/PUObrtlBstnpIVH1aB5IydBB3zr6wvodym/Sy9AKG8qi1NPgOixk7XBfJ0ub2o2lJBVdY2YsK6MFiWfO9/jnSuBHz1HHuGFSmuKC5XH6uUOHz+jhdUrndQChSiBXtTEoLRHQFj1a47bibbDrxxR4twzx7Bh/QTKlvCHKLzyf+oSbX66j0f/vYtlU1K/MAFSdyceEIVXAxdxeVy5fwPtRxHd9vw0GqBqIn4zWhpw4akeF5769gmDeADFr1mOXq/urHkN8Nyzx3DGKR20yoBDVhQ4+siSFUVWr014fZCUTue9bsCXrtsfOQIxWxNamiAKiOwZojxPHmBr75a/Y2hpP988pMEHYsfT1u0TEaFTyvMCS9m9htTWpIwlMMWuw8JizV3do99Z4PNXTnHLK9UXQemz4/rBhmW84naYw99fuw/PbR5g5XTBniwIT9bWuHcS+8YraAAfGyIZBlgGyHd45fv4UsTZW+rGmB7KghoVQkqK/J1XeEiIlLRJWRQ+DzzSx8+2DHHqB9osfK9Xs9DkKZRdpAucApDcXsb2uOX6WTz0r4tYQcIPc0HT59QBSpmgsBCILa98BSfb0jKa7jMAOEhTJOmGU2C85BCoINEvyT9IwHbL49WdFW68bZ6Xu9afPcZ3m+KUPFiASQiQkkuP/ftr3PS3s3j4/i73Aql+sc4vC6+rQIL2Qs+NY6QQqG0zZEZYLC2mYowfokVN1n6dGg/NV8YPzF1iBORlFK36BLS956XuP/3sPjy7ZYDL/2QJjv3VEr2+FDK8yKrZIa0byvS//0gPt39pDttfqHiVF4NEm2PDU0tgvpZ7AdMXMUZpW1Kb+4GaqY8+twpgx96A+x4PuPjDsmB54GukX3DQl1yfXwDuf7SHm766gJdfGeIPf38c11wxxd91aO/BQV673qjw1BMDPPhvi3j6yT7GSoeZZbKIa2UyNb3yJqitBebub6tPnosj22010rsf3exEgDNRAld9o8aPX3B412rdB2xgl1Hf0CiEMseoA3r9gG3bK/xw0wAvbB1iqkMkyeOw1QW+9s0FDAeCFeIwAYNewK5dNV7ZWmHb80O8uaNmUrR0Uqo6WgITmptITlRAg1LnZMiIEODec8MwkDV4707+A4isCHJD2cNr3GDfHLi/Z3v4448Xsj38EiepEOLqTru8RaDdHeDtLrZldn6/LnHbhLlNpwQmAB3vMNFxGOPtNZrmaqvzpbYXzm/ARyWvl4YIdYbU/Rn4CFMqYGq5ly0yVqUdUMnZ6q4Bl94zM2E9xGztTxc045aavK1Of1wxxQWiqDULYJuj6G/QEje7byAl6IT1YAF0H7HsKpUmjVV4eakcra6rwlIP6DJYtkbA6Ri8P0CB1jYv5u2lvBoULsfnnJpG9vCyIEqWZHeJrjJn48adGrzzSyZgGxek2ySeZqFjz3FjNd/vo0JKw8QEVgVqt0iKH1sDlBTKy+r6TLBx6nwFuPGefpMTc79Z3RRkPXw+H21njVSPcQ9fanXbWLymb/1/29RgkKmNTRuLBVXrxx0m+lkENmVY7S/zEWtrb9BWiRxlgZGCJ+a9PLHlfEDBTP2hsTFRdpVJNWdPx21qWVPDWtP5ik+j4Zn176wFzoWN9fcyoDNhI+dXppkA0XoCTQLEPCAIdhxk5Tur+nWPsChKYzxH97h/37aqm+z2Sw7ZvGRa5x5c3IuUlBBbVBYWBlymuEx4Gyuv74X4pDTXYILWD8ja4zRKYVR49Fcdxg3invt8yUsVJCRPHshrBWNZ+R49UYLt5tYfRcR6Xy0c3Ta5dJ6/Zd/vCNjlxCcueCa2l1pgGQDGzpIVSEPMyq6w5q+wzOoNUIzu0uz0SFhkHlHTiq4InO4zr9ENSjHO841N2e5ui3PrBTZQPFlagC0Jb54Vd4pZqNiOttgPoI4AZn1ZYLPzLoQatS2CNmod3T3W7Asc+Puc5D1JKRbpRJnFYgZAI9iQub7EvY9gxc9yW1vW+HgME3KkwSkNDs0EVnXqWqARIG3X1y3XDq0xbPbTS4q7vVcCN7qwGWM73/HV3P0t7iwImoOhlMZpe0rc8q7tblaE9vxzJaTCJa3nC/iZp6QFTgNGi/0mC9TvOTukUNLUG8Y6hZte7e/2l52Iu8ar6qXalR6hrhq5P0+LI7/DaYBgrHnMve1HEhYu6RkWgq2bvKDJ3cVGOfhZLOdYkaq8xPIYX2zVV72uyPBEN01XnTDuy2WLL33w+rG7/PpT3NyvrQ4bx9tww8qT1ejHNHFPQEJ6Ke0E1LJd2FmhR90g04xpP+tfKCjmYKaWIU/ImhcpTpXi2q7UfLeH9fXVqSVsTNiMD+Rh4uraDT2mlpXu8BNaG1etcnN+3T2huPcvWg8dubS6dHJJUfD6bFVXrq5rrw3+tCaXOuGmBENzAzHpu0tvL63uNj8bykdeoCkt8QHL+SqAkRxz60wJcQ9BFh6p7CX8CYEQLtShKocTfmbpRLHs3d1LT7u+9dA99tNZ+yHxBTcNztz0mr9x74I/hnZXhD7F/PCAn6bJz+U0vrPr7K5VJUJZf5/v040NDcG02LGGJVmfOsuxdifg03U9vUZHrPz0fl7p5caGjNkiEmTFUXBooUDbjWGs5TE+Pdyy6vjqijO+MPYACb+efjwdiYsqIewMk+d8tbro1b1uXXehPrYahmn+hZmGgtefqsalNFvU1BpAhM8QXhUlCmgCmihAUnBUQixk6J2eSYqwvM9Iz5sfrApM7LDF7W651oILbef3Tky0Nk2vcfeed0dxp3Nu7h6EYr2sgOL/Aa5OuMdnE5sWAAAAAElFTkSuQmCC";
		//#endregion
		//#region src/client/styles.ts
		/**
		* Client styles for the WorkBuddy plugin card.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — 整套 `dsm-*` 卡片样式系统（卡片外壳、按钮原语、`--dsw-alias-*`
		*     主题变量与十六进制回退值）逐字沿用自该项目，其又复制自
		*     dingminhua/dsh-subagent-default-model（MIT）的 SETTINGS_CSS。
		*     沿用目的是让两个插件共享同一套外部表现语言。
		* 改动：类名由 `dsm-trae-*` 改为 `dsm-workbuddy-*`；
		*   移除 trae 特有的 1M 变体样式，新增按套餐聚合的积分行样式；
		*   双 provider 化后新增国内版/国际版 tab 栏样式。
		*
		* @module dsh-connect-workbuddy/client/styles
		*/
		const WORKBUDDY_CARD_CSS = `
.dsm-plugin-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-3,#202126);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.dsm-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-plugin-card-open{background:var(--dsw-alias-bg-layer-2,#25262b);border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-plugin-card-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dsm-plugin-card-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:-2px}
.dsm-plugin-card-head{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dsm-plugin-card-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-weight:600;line-height:1.4}
.dsm-plugin-card-description{color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5}
/* Pure-CSS caret: the host primitives' chevron icon names differ per DSH line
   (0.1.5 Outline14 vs 0.1.7 OutlineRegular), so no static import can serve
   both. A border caret in the plugin's own CSS is version-proof. */
.dsm-plugin-card-chevron{color:var(--dsw-alias-label-tertiary,#999);flex:none;width:16px;height:16px;position:relative;transition:transform .16s}
.dsm-plugin-card-chevron::before{content:"";display:block;position:absolute;left:4px;top:5px;width:7px;height:7px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg)}
.dsm-plugin-card-chevron-open{transform:rotate(180deg)}
.dsm-plugin-card-body{border-top:1px solid var(--dsw-alias-border-l2,#36373b);margin:0 16px;padding:0 0 8px}
.dsm-plugin-card-icon{width:32px;height:32px;flex:none;border-radius:7px}
.dsm-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dsm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-btn:disabled{opacity:.4;cursor:default}
.dsm-btn-outline{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent;font-weight:500}
.dsm-btn-outline:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:rgba(255,255,255,.04)}
.dsm-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsm-btn-primary:hover:not(:disabled){opacity:.9}
.dsm-workbuddy-usage{display:flex;flex-direction:column;gap:16px;margin:0;padding:16px 0 4px}
.dsm-workbuddy-tabs{display:flex;gap:6px;padding:4px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#2a2c33)}
.dsm-workbuddy-tab{appearance:none;font:inherit;cursor:pointer;flex:1;border:0;border-radius:7px;padding:7px 10px;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;font-weight:500;line-height:18px;background:transparent;transition:color .15s,background .15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-workbuddy-tab:hover:not(:disabled):not(.dsm-workbuddy-tab-active){color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-workbuddy-tab-active{color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-bg-layer-2,#232529);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,#3a3d45)}
.dsm-workbuddy-tab-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:baseline}
.dsm-workbuddy-tab-cell{display:flex;align-items:center;gap:2px;flex:1;min-width:0}
.dsm-workbuddy-tab-switch{display:inline-flex;align-items:center;flex:none;padding:0 8px 0 2px;cursor:pointer}
.dsm-workbuddy-tab-switch input{margin:0;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-tab-switch input:disabled{opacity:.4;cursor:default}
.dsm-workbuddy-tab-off{opacity:.55}
/* Re-detection keeps a copy in the signed-out branch (that branch is where
   "I just signed in over there" applies), so it needs its own placement: the
   pool block's rule cannot reach it. */
.dsm-workbuddy-usage-account-actions{display:flex;gap:8px;margin:10px 0 0}
.dsm-workbuddy-tab-off-notice{color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px;margin:0 0 4px;padding:8px 10px;background:var(--dsw-alias-bg-layer-3,#2a2c33);border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px}
.dsm-workbuddy-usage-hint{padding-left:19px;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px}
.dsm-workbuddy-account-error{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px;line-height:18px;white-space:pre-line}
.dsm-workbuddy-usage-select-wrap{position:relative}
.dsm-workbuddy-usage-select{appearance:none;width:100%;font:inherit;padding:10px 34px 10px 12px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-bg-layer-3,#2a2c33);cursor:pointer;transition:border-color .15s,box-shadow .15s}
.dsm-workbuddy-usage-select:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary,#5686fe);box-shadow:0 0 0 3px rgba(86,134,254,.22)}
.dsm-workbuddy-usage-select:disabled{opacity:.6;cursor:default}
.dsm-workbuddy-usage-select-wrap::after{content:"";position:absolute;top:50%;right:12px;width:7px;height:7px;transform:translateY(-65%) rotate(45deg);border-right:1.6px solid var(--dsw-alias-label-secondary,#c6c9d0);border-bottom:1.6px solid var(--dsw-alias-label-secondary,#c6c9d0);pointer-events:none}
.dsm-workbuddy-usage-text{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary,#b8b8b8)}
.dsm-workbuddy-searched{margin-top:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-workbuddy-searched>summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#b8b8b8);user-select:none}
.dsm-workbuddy-searched-hint{margin:6px 0 4px;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-workbuddy-searched-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.dsm-workbuddy-searched-list li{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsm-workbuddy-searched-list code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#b8b8b8);word-break:break-all}
.dsm-workbuddy-searched-reason{color:var(--dsw-alias-label-tertiary,#999);font-size:11px}
.dsm-workbuddy-searched-reason-encrypted{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-searched-reason-wrong-region{color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-searched-more{margin-top:6px;padding:0;border:0;background:none;color:var(--dsw-alias-brand-primary,#5686fe);font:inherit;font-size:12px;line-height:18px;cursor:pointer;text-align:left}
.dsm-workbuddy-searched-more:hover{text-decoration:underline}
.dsm-workbuddy-usage-error{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-workbuddy-usage-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
.dsm-workbuddy-models{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:14px}
.dsm-workbuddy-models-fold{display:flex;flex-direction:column;gap:10px}
/* A plain header now: the section does not fold, so it is neither clickable nor
   focusable, and the list-marker rules that hid the native <details> triangle are
   gone with it. */
.dsm-workbuddy-models-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsm-workbuddy-models-title-row{display:flex;align-items:center;gap:6px;min-width:0}
.dsm-workbuddy-models-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}
/* Unsaved-changes marker. It sits in the HEADER rather than beside the save
   buttons at the foot of the list, so a pending edit is visible without
   scrolling to the end of a long model list. */
.dsm-workbuddy-models-dirty{margin-left:8px;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-state-warn-primary,#f59e0b);color:#1b1d22;font-size:11px;font-weight:600;line-height:16px;vertical-align:1px;white-space:nowrap}
.dsm-workbuddy-models-summary{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
.dsm-workbuddy-model-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;overflow:hidden}
.dsm-workbuddy-model{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2,#232529);transition:opacity .16s}
.dsm-workbuddy-model-disabled{opacity:.55}
.dsm-workbuddy-model+.dsm-workbuddy-model{border-top:1px solid var(--dsw-alias-border-l2,#36373b)}
.dsm-workbuddy-model-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsm-workbuddy-model-enabled{display:flex;align-items:center;gap:8px;min-width:0;cursor:pointer;flex:1}
.dsm-workbuddy-model-enabled input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe);flex:none}
.dsm-workbuddy-model-image{display:inline-flex;align-items:center;gap:5px;flex:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}
.dsm-workbuddy-model-image input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-model-off{display:inline-flex;align-items:center;gap:5px;flex:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}
.dsm-workbuddy-model-off input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-model-copy{display:flex;align-items:baseline;gap:8px;min-width:0}
.dsm-workbuddy-model-name{display:inline-flex;align-items:baseline;gap:7px;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-weight:500;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-model-name-rate{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;font-weight:400;line-height:16px;flex:none}
.dsm-workbuddy-model-id{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-model-desc{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px}
.dsm-workbuddy-model-details{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsm-workbuddy-model-meta{display:flex;align-items:center;gap:7px 12px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px}
.dsm-workbuddy-model-meta-tag{padding:1px 7px;border-radius:999px;font-size:11px;line-height:15px;background:rgba(174,179,187,.11);color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-context-budget{display:flex;align-items:center;justify-content:flex-end;gap:12px;flex:none;margin:0;padding:0;border:0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}
.dsm-workbuddy-context-budget label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.dsm-workbuddy-context-budget input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-model-capability-note{margin:0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
/* Model probe (test button + result). The result line is its own row under the
   meta line, because a cooldown sentence ("rate limited - the upstream gave no
   time") does not fit next to the context/output chips, and truncating it would
   hide exactly the part the user needs. */
.dsm-workbuddy-models-head-actions{display:flex;align-items:center;gap:8px;flex:none}
.dsm-workbuddy-model-probe{flex:none;padding:3px 10px;font-size:11px;line-height:16px}
.dsm-workbuddy-model-probe-result{margin:0;font-size:12px;line-height:18px;word-break:break-word}
.dsm-workbuddy-model-probe-result-ok{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-model-probe-result-warn{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-model-probe-result-bad{color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-workbuddy-model-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:12px}
.dsm-workbuddy-model-save-error{flex:1;min-width:0;color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px;line-height:16px;text-align:right}
.dsm-workbuddy-model-actions-buttons{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.dsm-workbuddy-usage-cheer{display:inline-flex;align-items:center;gap:4px;flex:none;text-decoration:underline;text-underline-offset:2px;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5;transition:color .16s}
.dsm-workbuddy-usage-cheer-star{font-size:12px;line-height:1;display:inline-flex}
.dsm-workbuddy-usage-cheer:hover{color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-usage-cheer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}

/* ---- Account pool ---- */
.dsm-workbuddy-pool{display:flex;flex-direction:column;gap:12px;margin:0;padding:16px 0 4px;border-top:1px solid var(--dsw-alias-border-l2,#36373b)}
.dsm-workbuddy-pool-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsm-workbuddy-pool-current-badge{padding:2px 10px;border-radius:999px;background:rgba(86,134,254,.16);color:var(--dsw-alias-brand-primary,#5686fe);font-size:12px;font-weight:600;line-height:18px;white-space:nowrap}
/* Sits under the header block, before the batch buttons: account discovery is
   the first step of using the pool, so it reads above the actions it enables. */
/* Manual-mode account picker: shares the settings row layout (.pool-set), and
   only the select itself needs a hint that it is a PICKER of accounts rather
   than of models — the two sit near each other and used to be indistinguishable
   to a selector query as well as to the eye. */
.dsm-workbuddy-pool-account-select{min-width:200px}
.dsm-workbuddy-pool-title{margin:0;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-pool-badge{flex:none;padding:2px 9px;border-radius:999px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-brand-primary,#5686fe);background:rgba(86,134,254,.12);border:1px solid rgba(86,134,254,.32)}
/* One row, two clusters: LEFT acts on the accounts you checked, RIGHT re-reads
   which accounts exist. Before this the rescan button was on its own row pushed
   right while the batch buttons were on the next row pushed left — two
   alignments two lines apart, with nothing explaining the split. */
.dsm-workbuddy-pool-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:12px}
.dsm-workbuddy-pool-actions-group{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-workbuddy-pool-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-workbuddy-pool-note{margin:0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-workbuddy-pool-warn{margin:0;padding:9px 11px;border-radius:9px;font-size:12px;line-height:17px;color:var(--dsw-alias-state-warn-primary,#f59e0b);background:rgba(245,158,11,.09);border:1px solid rgba(245,158,11,.3)}
.dsm-workbuddy-pool-error{margin:0;font-size:12px;line-height:17px;color:var(--dsw-alias-state-error-primary,#ef4444);white-space:pre-line}
.dsm-workbuddy-pool-table{border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#24262c)}
.dsm-workbuddy-pool-row{display:grid;grid-template-columns:1.6fr 1fr 1.3fr .9fr;gap:10px;align-items:center;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1,#2c2d31);font-size:13px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-row:first-child{border-top:0}
.dsm-workbuddy-pool-row-head{padding:8px 14px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-tertiary,#999);font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
.dsm-workbuddy-pool-row-current{background:rgba(86,134,254,.07)}
/* The serving row, made findable at a glance: a left accent bar plus the tint.
   The bar is what distinguishes it in a long table, where a 7%-opacity wash
   alone reads as an alternating-row stripe. */
.dsm-workbuddy-pool-row-current{box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-pool-account{display:flex;align-items:center;gap:8px;min-width:0}
.dsm-workbuddy-pool-account-name{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsm-workbuddy-pool-account-name b{font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-pool-account-name span{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#999)}
/* Declared AFTER the blanket span rule so it wins: the badge must not inherit
   the muted 11px tertiary treatment the membership line uses. */
.dsm-workbuddy-pool-account-name .dsm-workbuddy-pool-current-tag{align-self:flex-start;margin-top:2px;padding:1px 6px;border-radius:999px;background:rgba(86,134,254,.16);color:var(--dsw-alias-brand-primary,#5686fe);font-size:11px;font-weight:600;line-height:16px;white-space:nowrap}
.dsm-workbuddy-pool-excluded{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-pool-credits{display:flex;flex-direction:column;gap:1px;min-width:0;font-variant-numeric:tabular-nums}
.dsm-workbuddy-pool-credits b{color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:600}
.dsm-workbuddy-pool-soon{font-size:11px;line-height:16px;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-pool-soon-plain{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-workbuddy-pool-probe,.dsm-workbuddy-pool-checkin{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#999);min-width:0;overflow-wrap:anywhere}
.dsm-workbuddy-pool-probe{display:flex;flex-direction:column;gap:4px}
.dsm-workbuddy-pool-probe-main{color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-probe-prov{display:flex;align-items:center;gap:5px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#999);min-width:0;flex-wrap:wrap}
.dsm-workbuddy-pool-prov-tag{padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-tertiary,#999);font-size:10px;font-weight:600;line-height:15px;white-space:nowrap}
.dsm-workbuddy-pool-prov-live{background:rgba(245,158,11,.16);color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-pool-prov-unknown{background:var(--dsw-alias-bg-layer-3,#2a2c33);border:1px solid var(--dsw-alias-border-l1,#2c2d31);color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-prov-sep{color:var(--dsw-alias-label-dimmed,#9aa0a6);opacity:.7}
.dsm-workbuddy-pool-prov-age{color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap}
.dsm-workbuddy-pool-members{display:flex;flex-direction:column;gap:10px}
.dsm-workbuddy-pool-members-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsm-workbuddy-pool-members-title{margin:0 0 3px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-pool-members-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-workbuddy-pool-small-btn{padding:3px 10px;font-size:12px}
.dsm-workbuddy-pool-check{display:inline-flex;align-items:center;flex:none;cursor:pointer}
.dsm-workbuddy-pool-check input{margin:0;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-pool-check input:disabled{cursor:default;opacity:.5}
.dsm-workbuddy-pool-checked{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-pool-unknown{color:var(--dsw-alias-label-dimmed,#9aa0a6)}
.dsm-workbuddy-pool-member{color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-pool-not-member{color:var(--dsw-alias-label-dimmed,#9aa0a6)}
.dsm-workbuddy-pool-settings-wrap{display:flex;flex-direction:column;gap:10px}
.dsm-workbuddy-pool-dirty{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-pool-settings{display:flex;flex-direction:column;gap:1px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#24262c)}
.dsm-workbuddy-pool-set{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 14px;border-top:1px solid var(--dsw-alias-border-l1,#2c2d31)}
.dsm-workbuddy-pool-set:first-child{border-top:0}
.dsm-workbuddy-pool-set-copy{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.dsm-workbuddy-pool-set-copy b{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-pool-set-copy span{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-workbuddy-pool-set-ctl{flex:none;display:flex;align-items:center;gap:8px}
.dsm-workbuddy-pool-num{width:74px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:13px;text-align:center;font-variant-numeric:tabular-nums}
.dsm-workbuddy-pool-select{max-width:260px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:13px;cursor:pointer}
.dsm-workbuddy-pool-select:disabled,.dsm-workbuddy-pool-num:disabled{opacity:.5;cursor:default}
.dsm-workbuddy-pool-save-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:12px}
.dsm-workbuddy-pool-save-buttons{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:none}
.dsm-workbuddy-pool-conflict{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:11px 13px;border-radius:10px;background:rgba(245,158,11,.08);border:1px solid var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-pool-pending{flex:none;align-self:center;font-size:12px;line-height:17px;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-pool-conflict-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dsm-workbuddy-pool-conflict-main b{font-size:12px;font-weight:600;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-pool-conflict-main span{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-log{border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#24262c)}
.dsm-workbuddy-pool-log-head{display:flex;align-items:center;justify-content:space-between;padding:9px 14px;background:var(--dsw-alias-bg-layer-3,#2a2c33);border-bottom:1px solid var(--dsw-alias-border-l1,#2c2d31);font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-log-clear{padding:2px 10px;font-size:12px}
.dsm-workbuddy-pool-log-body{max-height:186px;overflow-y:auto}
.dsm-workbuddy-pool-log-row{display:flex;gap:10px;padding:7px 14px;border-top:1px solid var(--dsw-alias-border-l1,#2c2d31);font-size:12px;line-height:18px}
.dsm-workbuddy-pool-log-row:first-child{border-top:0}
.dsm-workbuddy-pool-log-time{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dsm-workbuddy-pool-log-text{min-width:0;overflow-wrap:anywhere}
.dsm-workbuddy-pool-log-ok{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-pool-log-warn{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsm-workbuddy-pool-log-error{color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-workbuddy-pool-log-info{color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-pool-log-empty{padding:14px;font-size:12px;color:var(--dsw-alias-label-tertiary,#999)}
@media (max-width:760px){.dsm-workbuddy-pool-row{grid-template-columns:1fr 1fr;row-gap:6px}.dsm-workbuddy-pool-select{max-width:180px}}
/* Pool switch, namespaced under .dsm-workbuddy-pool so it cannot collide with host styles. */
.dsm-workbuddy-pool .sw{position:relative;display:inline-block;width:38px;height:22px;flex:none;cursor:pointer}
.dsm-workbuddy-pool .sw input{position:absolute;opacity:0;width:0;height:0}
.dsm-workbuddy-pool .sw-track{position:absolute;inset:0;border-radius:999px;background:var(--dsw-alias-border-l2,#3a3d45);transition:background .18s}
.dsm-workbuddy-pool .sw-track::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .18s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.dsm-workbuddy-pool .sw input:checked+.sw-track{background:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-pool .sw input:checked+.sw-track::after{transform:translateX(16px)}
.dsm-workbuddy-pool .sw input:disabled+.sw-track{opacity:.4}
.dsm-workbuddy-pool .sw input:disabled{cursor:default}
`;
		//#endregion
		//#region src/client/searched-paths.ts
		/**
		* Reasons that explain a failure, as opposed to merely recording an absence.
		*
		* `missing` is the normal state of most candidates on any machine — the app
		* writes one file while the platform offers several possible directories — so
		* it is the one reason that gets hidden by default. Everything else is a real
		* finding: the file is there and unreadable, present but not a credential, or
		* present and encrypted without a key.
		*
		* `encrypted` is WorkBuddy-specific and the most important of the three: the
		* user is very likely signed in already, and the plugin simply cannot open the
		* token fields without the desktop app present. "Sign in again" is the one
		* action that cannot help, so this reason must never be hidden behind a toggle.
		*
		* `wrong-region` is equally a finding and equally actionable: the sign-in is
		* real and readable, it just belongs to the other tab. That is why it must be
		* shown up front — hidden among the absences it would look like "nothing here",
		* when it is in fact the whole explanation, and the cheapest possible fix.
		*/
		const INTERESTING_REASONS = [
			"encrypted",
			"invalid",
			"unreadable",
			"wrong-region"
		];
		/**
		* Partition one region's probe failures for display.
		*
		* Order within each group is preserved from the Host: the store reports
		* candidates in probe order, which is meaningful (the live file before its
		* timestamped backups).
		*
		* There is deliberately no `encrypted` flag here. There used to be, for a
		* notice rendered inside the list; that notice is gone because
		* {@link signedOutNotice} now answers the encrypted cause in the paragraph, so
		* the flag would have had no consumer — and a derived field kept "just in
		* case" is how the list and the paragraph drift apart again.
		*/
		function searchedView(items) {
			const interesting = items.filter((item) => INTERESTING_REASONS.includes(item.reason));
			return {
				interesting,
				missing: items.filter((item) => !INTERESTING_REASONS.includes(item.reason)),
				missingOpen: interesting.length === 0,
				total: items.length
			};
		}
		/** Every reason's locale key, so no reason can silently fall through to a wrong one. */
		const REASON_KEYS = {
			missing: "row.reasonMissing",
			unreadable: "row.reasonUnreadable",
			invalid: "row.reasonInvalid",
			encrypted: "row.reasonEncrypted",
			"wrong-region": "row.reasonWrongRegion"
		};
		/** The reason's short label; `missing`/`unreadable`/`invalid`/`encrypted`/`wrong-region`. */
		function searchReasonKey(reason) {
			return REASON_KEYS[reason] ?? "row.reasonInvalid";
		}
		/**
		* One entry's cause line: which store the path belongs to, and why it failed.
		*
		* The source matters because the two are fixed differently — a desktop-app path
		* is about the app's installation and sign-in, a plugin-owned copy is about the
		* plugin's own storage.
		*/
		function searchReasonLabel(item, t) {
			return `${t(item.source === "desktop" ? "row.sourceDesktop" : "row.sourceDsh")} · ${t(searchReasonKey(item.reason))}`;
		}
		/**
		* Choose the signed-out paragraph's copy.
		*
		* This exists because the card was saying the same thing twice. `resolve()`
		* refuses with a message that already ENUMERATES every path it tried
		* (`expected <Local>\workbuddy-desktop.info or <Roaming>\... or
		* WORKBUDDY_AUTH_FILE`), and the probed-path `<details>` right below it listed
		* those same paths with a per-entry reason. Both hint keys also opened with a
		* variant of "no sign-in was found", so one screen carried four statements of
		* one fact and the user's eye had nowhere to land.
		*
		* The rule: the paragraph states the situation, the list supplies the detail.
		* Whenever a list is rendered, the enumeration in `message` is redundant by
		* construction — the list is the same paths, with strictly better reasons — so
		* the paragraph falls back to the concise hint. Measured against the real
		* `resolve()` branches, the only content this drops is "or refresh an existing
		* session", which is vacuous exactly here: `searched` is attached only when
		* there are zero accounts, so there is no session to refresh.
		*
		* `selectionLost` still wins outright: there the tokens are healthy and the
		* advice is to re-pick an account, which no path list can replace.
		*
		* `encrypted` also outranks the generic hint, and for the same reason
		* `wrong-region` does: the generic copy tells the user to sign in again, which
		* is precisely the action that cannot work when the credential exists but is
		* encrypted. Leaving it in the collapsed list meant the headline contradicted
		* the detail below it — and the headline is the only part most users read.
		*/
		function signedOutNotice(input) {
			if (input.selectionLost) return { key: "row.selectionLostMessage" };
			if (input.searched.some((item) => item.reason === "wrong-region")) return { key: "row.signedOutWrongRegion" };
			if (input.searched.some((item) => item.reason === "encrypted")) return { key: "row.signedOutEncrypted" };
			if (input.searched.length > 0) return { key: "row.signedOutHint" };
			return input.message === void 0 ? { key: "row.signedOutHint" } : {
				key: "row.signedOutHint",
				fallback: input.message
			};
		}
		/**
		* The paragraph's final text: the localized copy, plus the Host message only
		* when {@link signedOutNotice} decided nothing supersedes it.
		*
		* Kept here rather than inline in the JSX so the anti-duplication guarantee can
		* be asserted on the string that is actually rendered, not on its inputs.
		*/
		function signedOutText(notice, t) {
			const hint = t(notice.key);
			return notice.fallback === void 0 ? hint : `${hint} (${notice.fallback})`;
		}
		//#endregion
		//#region src/client/WorkBuddyCard.tsx
		/**
		* WorkBuddy credits & models card contributed to Harness Plugin configuration.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — 卡片的整体结构（折叠外壳 / 账号状态行 / 账号下拉 / 积分区 / 模型表 /
		*     操作按钮行）、模块加载时注入一次 `<style>` 的写法、
		*     草稿态（draftModels/draftEnabledIds）与 dirty 标记的保存流程、
		*     60 秒轮询与 AbortController 清理，均来自该项目的 TraeUsageCard。
		*   折叠卡片外壳与 `settings.plugin.item` 槽位形态来自
		*   dingminhua/dsh-subagent-default-model（MIT）。
		* 改动：
		*   0. 折叠箭头改用纯 CSS caret（理由见 styles.ts）：两版宿主的图标命名族
		*      不同，静态导入必挂一边。此前沿用的 `IconChevronDownOutline14` 已
		*      随该改动移除，故不再计入上方参考项。
		*   1. 积分区改为「合计 + 按套餐名聚合的进度条」，因为实测单个账号下
		*      同名套餐可达 19 个，逐条渲染会淹没卡片（原项目按上游条目直出）；
		*   2. 模型行补上 WorkBuddy 上游给出的积分倍率、多模态与推理档位；
		*   3. 移除与 WorkBuddy 上游无关的 1M 变体勾选；
		*   4. 双 provider 化后卡片顶部为「国内版 / 国际版」tab 栏 —— 每个 tab
		*      是一个独立供应商（workbuddy / workbuddy-global），账号、积分、
		*      模型目录与草稿完全按区域隔离，切 tab 不丢另一侧未保存的草稿。
		*
		* @module dsh-connect-workbuddy/client/WorkBuddyCard
		*/
		const POLL_INTERVAL_MS = 6e4;
		/**
		* Tooltip for one model's image checkbox. The box is pre-checked only for
		* models the vendored vendor table documents as natively multimodal, so the
		* two other outcomes need to say WHY they are off — otherwise a documented
		* text-only model and an unverified one look identically broken next to their
		* checked siblings.
		*/
		function imageCheckboxHint(model, t) {
			switch (nativeModalityOf(model.id)) {
				case "multimodal": return t("row.modelImage");
				case "text": return t("row.modelImageText");
				default: return t("row.modelImageUnverified");
			}
		}
		/** Inject or refresh the shared card CSS for the current client bundle. */
		if (typeof document !== "undefined") {
			const cssId = "dsh-connect-workbuddy/client.css";
			const existing = document.querySelector(`style[data-plugin-css="${cssId}"]`);
			if (existing !== null) existing.textContent = WORKBUDDY_CARD_CSS;
			else {
				const styleTag = document.createElement("style");
				styleTag.dataset.plugin = "dsh-connect-workbuddy";
				styleTag.dataset.pluginCss = cssId;
				styleTag.textContent = WORKBUDDY_CARD_CSS;
				document.head.appendChild(styleTag);
			}
		}
		/**
		* One probed path, with its cause. The presentation rules — which entries are
		* worth showing up front, and how a reason is labelled — live in
		* `./searched-paths.ts` so they are unit-testable without a DOM.
		*/
		function renderSearchedItem(item, t) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: item.path }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: `dsm-workbuddy-searched-reason${item.reason === "encrypted" ? " dsm-workbuddy-searched-reason-encrypted" : item.reason === "wrong-region" ? " dsm-workbuddy-searched-reason-wrong-region" : ""}`,
				children: [searchReasonLabel(item, t), item.message === void 0 ? null : ` · ${item.message}`]
			})] }, `${item.source}:${item.path}`);
		}
		/**
		* The probed-path list behind a signed-out card.
		*
		* Collapsed by default because it is a diagnostic, not a headline. The
		* interesting failures (encrypted / invalid / unreadable) are listed up front;
		* the merely-absent candidates — most of them, on any normal machine — sit
		* behind a second toggle, so the one entry that explains the failure is not
		* buried under a dozen "not found" lines. When nothing interesting was found
		* the absent list IS the explanation, so it opens directly.
		*
		* An `encrypted` failure deliberately adds NO notice of its own. It used to,
		* because the paragraph above still said "sign in once in the desktop app" —
		* the one action that cannot work when the credential exists but is encrypted.
		* `signedOutNotice` now answers that cause in the paragraph itself, so a second
		* copy here would restate it: the paragraph states the situation, this list
		* supplies the detail, and the per-entry label already says what each path is.
		*/
		function SearchedPaths({ items, t }) {
			const view = searchedView(items);
			const [explicitOpen, setExplicitOpen] = (0, react.useState)(void 0);
			const showMissing = explicitOpen ?? view.missingOpen;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: "dsm-workbuddy-searched",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
						t("row.searchedTitle"),
						" (",
						view.total,
						")"
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-workbuddy-searched-hint",
						children: t("row.searchedHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
						className: "dsm-workbuddy-searched-list",
						children: [view.interesting.map((item) => renderSearchedItem(item, t)), showMissing ? view.missing.map((item) => renderSearchedItem(item, t)) : null]
					}),
					showMissing || view.missing.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsm-workbuddy-searched-more",
						onClick: () => {
							setExplicitOpen(true);
						},
						children: t("row.searchedMore", { count: view.missing.length })
					})
				]
			});
		}
		function formatNumber(value) {
			return new Intl.NumberFormat(void 0, {
				minimumFractionDigits: 0,
				maximumFractionDigits: 2
			}).format(value);
		}
		/**
		* Compact package-date rendering with time, e.g. `08/25 14:44`.
		*
		* `hourCycle: 'h23'` is what makes that example TRUE. Without it `Intl` defers
		* to the browser locale, and en-US produced `08/25, 02:44 PM` — 12-hour, with a
		* comma the template never asked for. `h23` (not `hour12: false`) keeps midnight
		* at `00:00` instead of `24:00`, and matches DSH's own clock cycle.
		*/
		function formatDate(value) {
			return new Intl.DateTimeFormat(void 0, {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23"
			}).format(new Date(value));
		}
		function formatCapacity(value, unknown) {
			if (value === void 0) return unknown;
			if (value >= 1e6 && value % 1e6 === 0) return `${value / 1e6}M`;
			if (value >= 1e3 && value % 1e3 === 0) return `${value / 1e3}K`;
			return formatNumber(value);
		}
		function dotStyle(status) {
			return { background: status === "signed-in" ? "var(--dsw-alias-state-success-primary, #22a06b)" : status === "error" ? "var(--dsw-alias-state-error-primary, #d92d20)" : "var(--dsw-alias-label-dimmed, #9aa0a6)" };
		}
		/**
		* The sentence a probe result gets, and how it should be coloured.
		*
		* The cooldown wording is the part that had to be got right. The upstream names
		* a "use again" time in three situations: a `Retry-After` header, the reset
		* sentence it writes into its own failure BODY (where this service actually
		* puts it — its 429s carry no rate-limit header at all), or an exhausted
		* monthly quota whose refresh point it declares. So a limited result WITHOUT
		* any stated time must say that plainly. Substituting a locally invented
		* countdown would be the single most misleading thing this feature could do: it
		* would look like an upstream answer while being a guess, and the user would
		* wait for a moment that means nothing.
		*/
		/**
		* ` · 约 1 小时后` for a future instant, or `''` when there is none.
		*
		* Kept beside {@link probeResultView} rather than inlined three times so the
		* "append only when non-empty" rule cannot drift between the two limited
		* outcomes. The absolute instant stays the primary text: it is the upstream's
		* own answer, and the relative form is a convenience derived from it.
		*/
		function retrySuffix(t, untilMs, nowMs) {
			if (untilMs === void 0) return "";
			const remaining = remainingText(t, untilMs, nowMs);
			return remaining === "" ? "" : ` · ${remaining}`;
		}
		function probeResultView(result, t, nowMs = Date.now()) {
			switch (result.outcome) {
				case "ok": {
					const elapsed = result.elapsedMs === void 0 ? void 0 : `${String(result.elapsedMs / 1e3)}s`;
					return {
						text: elapsed === void 0 ? t("row.probeOk") : t("row.probeOkMs", { ms: elapsed }),
						tone: "ok"
					};
				}
				case "rate-limited": return {
					text: result.retryAtMs === void 0 ? t("row.probeRateLimitedUnknown") : t("row.probeRateLimitedAt", { at: formatDate(result.retryAtMs) }) + retrySuffix(t, result.retryAtMs, nowMs),
					tone: "warn"
				};
				case "out-of-credit": return {
					text: result.retryAtMs === void 0 ? t("row.probeOutOfCreditUnknown") : t("row.probeOutOfCreditAt", { at: formatDate(result.retryAtMs) }) + retrySuffix(t, result.retryAtMs, nowMs),
					tone: "bad"
				};
				case "credential-rejected": return {
					text: t("row.probeCredentialRejected"),
					tone: "bad"
				};
				case "policy-rejected": return {
					text: t("row.probePolicyRejected"),
					tone: "bad"
				};
				case "not-found": return {
					text: t("row.probeNotFound"),
					tone: "bad"
				};
				case "unavailable": return {
					text: t("row.probeUnavailable"),
					tone: "bad"
				};
				default: return {
					text: result.status === void 0 ? t("row.probeFailed") : t("row.probeFailedStatus", { status: String(result.status) }),
					tone: "bad"
				};
			}
		}
		/** Render WorkBuddy sign-in state, credits, and model selection as one card. */
		function WorkBuddyCard({ t, settingsScope, view }) {
			if (t === void 0) throw new Error("WorkBuddy plugin card requires its translation function");
			const [open, setOpen] = (0, react.useState)(view === "page");
			/** The region whose tab is on screen; each tab is its own provider stack. */
			const [activeRegion, setActiveRegion] = (0, react.useState)("cn");
			/**
			* Last-known usage per region, so tab dots survive tab switches.
			*
			* The placeholder carries `selectionExplicit: false` because that is the
			* state the plugin documents as the default before any choice is saved. It
			* is never rendered: the account picker and its state line only appear once
			* a real fetch has populated `accounts`.
			*/
			const [statusByRegion, setStatusByRegion] = (0, react.useState)({
				cn: {
					status: "signed-out",
					accounts: [],
					selectionExplicit: false
				},
				global: {
					status: "signed-out",
					accounts: [],
					selectionExplicit: false
				}
			});
			const [busy, setBusy] = (0, react.useState)(false);
			const [settingsRevision, setSettingsRevision] = (0, react.useState)(0);
			/** Per-region unsaved model edits; a draft on one tab is never dropped by
			* switching to the other tab, only by that tab's discard/save. */
			const [drafts, setDrafts] = (0, react.useState)({});
			const [saving, setSaving] = (0, react.useState)(false);
			/** Save failure surfaced next to the buttons; cleared by the next attempt. */
			const [saveError, setSaveError] = (0, react.useState)(void 0);
			const [switchingAccount, setSwitchingAccount] = (0, react.useState)(false);
			/**
			* Whether the account pool's save is in flight. Both sections write into one
			* region slot and the Host merges per-region, so two concurrent saves can
			* interleave on a stale base and revert each other while both report success
			* — the two save buttons are serialized to make that impossible.
			*/
			const [poolBusy, setPoolBusy] = (0, react.useState)(false);
			/** A refused account write (silently unpersisted settings on a locked file). */
			const [accountError, setAccountError] = (0, react.useState)(void 0);
			/** Region whose on/off checkbox write is in flight, so its box can't race. */
			const [togglingRegion, setTogglingRegion] = (0, react.useState)(void 0);
			/**
			* Probe results, keyed by region then model id.
			*
			* Kept per region for the same reason drafts are: the two tabs are separate
			* provider stacks, so a test run on one tab must not be clobbered — or shown —
			* as the other tab's answer.
			*/
			const [probes, setProbes] = (0, react.useState)({});
			/** Model ids with a probe in flight, so each row's button can disable itself. */
			const [probing, setProbing] = (0, react.useState)({});
			/** Probe failure that is not attributable to one model (a dead route, say). */
			const [probeError, setProbeError] = (0, react.useState)(void 0);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			(0, react.useEffect)(() => settingsScope?.subscribe(() => {
				setSettingsRevision((value) => value + 1);
			}), [settingsScope]);
			/**
			* Per-region latest-wins guard for the usage fetch.
			*
			* Two refreshes can overlap — the 60s poll, a save, a batch action, the
			* account re-scan — and they are plain `fetch`es with no ordering guarantee.
			* Without a guard the SLOWER response wins, so a snapshot taken before a
			* check-in could land after one taken after it and overwrite the newer
			* credits. The guard makes "the last request started" the one that is applied,
			* whatever order the responses arrive in.
			*
			* Keyed by region, not global: the card deliberately fetches BOTH regions at
			* once (`for (const region of WORKBUDDY_REGIONS)` below), so a single shared
			* counter would make each of those two calls cancel the other and leave one
			* tab permanently stale.
			*
			* The rule itself is the tested `createLatestWins` factory, not a second
			* implementation written here.
			*
			* `begin()` returns a probe that reports **stale**: `true` once a newer call
			* has claimed the same region (see `src/account-pool.ts`). So the variable is
			* named `stale` and the bail-out is `if (stale())` — the same polarity as the
			* Host's rotation guard in `src/index.ts`. Naming it `fresh` and writing
			* `if (!fresh())` inverts the poll: every response that is NOT superseded —
			* i.e. every response in the single-fetch case — gets discarded, and the card
			* renders its placeholder forever. That defect shipped once; the polarity is
			* now pinned by a rendered assertion rather than by the spelling of the
			* identifier.
			*/
			const usageGuard = (0, react.useRef)(createLatestWins());
			const refreshUsage = (0, react.useCallback)(async (region, signal) => {
				const stale = usageGuard.current.begin(region);
				try {
					const response = await fetch(withWorkBuddyRegion(WORKBUDDY_USAGE_PATH, region), {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const usage = value;
					if (stale()) return void 0;
					if (mounted.current && signal?.aborted !== true) setStatusByRegion((prev) => ({
						...prev,
						[region]: usage
					}));
					return usage;
				} catch (error) {
					if (stale()) return void 0;
					if (mounted.current && signal?.aborted !== true) {
						const message = error instanceof Error ? error.message : t("row.requestFailed");
						setStatusByRegion((prev) => {
							const previous = prev[region];
							if (previous !== void 0 && previous.status === "signed-in") return {
								...prev,
								[region]: {
									...previous,
									refreshError: message
								}
							};
							return {
								...prev,
								[region]: {
									status: "error",
									message
								}
							};
						});
					}
					return;
				}
			}, [t]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const controller = new AbortController();
				for (const region of WORKBUDDY_REGIONS) refreshUsage(region, controller.signal);
				return () => {
					controller.abort();
				};
			}, [
				open,
				activeRegion,
				refreshUsage
			]);
			const status = statusByRegion[activeRegion] ?? {
				status: "signed-out",
				accounts: [],
				selectionExplicit: false
			};
			(0, react.useEffect)(() => {
				if (!open || status.status !== "signed-in") return;
				const controller = new AbortController();
				const timer = window.setInterval(() => {
					refreshUsage(activeRegion, controller.signal);
				}, POLL_INTERVAL_MS);
				return () => {
					window.clearInterval(timer);
					controller.abort();
				};
			}, [
				open,
				activeRegion,
				refreshUsage,
				status.status
			]);
			/**
			* Re-detect the local sign-ins and refresh the panel.
			*
			* This deliberately writes NO account selection. It used to persist whatever
			* row the store reported as "selected" whenever that differed from the saved
			* value, which had two harmful effects: with no explicit choice it turned the
			* documented default (follow the app's current sign-in) into a permanent
			* explicit binding — so a later sign-in in the app was no longer followed —
			* and with an orphaned saved id it silently re-bound the region to a
			* different account, which is the silent switch that the strict
			* no-fallback rule exists to prevent. Re-detecting and re-picking are
			* separate actions now; the picker and Clear button own the selection.
			*/
			const rescanAccounts = async () => {
				setBusy(true);
				try {
					const response = await fetch(withWorkBuddyRegion(WORKBUDDY_ACCOUNTS_REFRESH_PATH, activeRegion), {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const body = await response.json();
					if (!response.ok || !Array.isArray(body.accounts)) throw new Error(`HTTP ${response.status}`);
					await refreshUsage(activeRegion);
				} finally {
					if (mounted.current) setBusy(false);
				}
			};
			const switchAccount = async (accountId) => {
				if (settingsScope === void 0) return;
				setSwitchingAccount(true);
				setAccountError(void 0);
				try {
					await writeAccountSlot(settingsScope, activeRegion, accountId);
					await refreshUsage(activeRegion);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setSwitchingAccount(false);
				}
			};
			/**
			* Whether one region's provider is switched on.
			*
			* The HOST's answer wins, because on this deployment it is the only writer
			* that lands: the switch goes through the plugin's Host save endpoint (that
			* endpoint is the only writer that cannot drop the sibling region), and a
			* write made there does NOT update the browser settings mirror. Reading the
			* mirror therefore left the checkbox stuck ON after a successful disable —
			* "不能正确取消国际版/国内版" — even though `enabled: false` was already in
			* the profile configuration. The Host sends the committed value it derives
			* from its own config (`status.enabled`, see `deps.regionEnabled`), so the
			* card renders that.
			*
			* The mirror stays as the FALLBACK: a host that predates the field, or a
			* status that has not loaded yet, still renders from the stored document
			* rather than guessing. Both rules are the same opt-out rule (only an
			* explicit `false` disables), so the two sources cannot disagree — only one
			* of them can be stale.
			*/
			const regionOn = (item) => {
				const fromHost = statusByRegion[item]?.enabled;
				if (typeof fromHost === "boolean") return fromHost;
				return regionEnabledOf(settingsScope?.getSnapshot().value, item);
			};
			const activeRegionOn = regionOn(activeRegion);
			/**
			* Switch one region's provider off or on. The write carries the region's
			* whole slot through untouched — only `enabled` changes — so the user's
			* directory, model picks, image opt-ins and budgets survive a round trip.
			* The Host withdraws or restores the provider route on the next `onChange`,
			* which is what actually removes it from DSH's model picker.
			*
			* Goes through `writeRegionEnabled` rather than calling `scope.set()`
			* directly: on the affected 0.1.7 deployments that scope settles without
			* storing anything, so a direct write appeared to succeed and then silently
			* reverted. The helper adds the landed-check and the Host-endpoint fallback
			* that every other settings write already had.
			*/
			const toggleRegion = async (item, enabled) => {
				if (settingsScope === void 0) return;
				setTogglingRegion(item);
				try {
					const slot = nextRegionEnabled(settingsScope.getSnapshot().value, item, enabled)[item];
					await writeRegionEnabled(settingsScope, item, enabled, typeof slot === "object" && slot !== null ? slot : {});
					await refreshUsage(item);
				} catch (error) {
					if (mounted.current) setAccountError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setTogglingRegion(void 0);
				}
			};
			const refreshModels = async () => {
				setBusy(true);
				try {
					const response = await fetch(withWorkBuddyRegion(WORKBUDDY_MODELS_REFRESH_PATH, activeRegion), {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const body = await response.json();
					if (!response.ok || !Array.isArray(body.models)) throw new Error(`HTTP ${response.status}`);
					const fresh = body.models;
					const freshIds = new Set(fresh.map((model) => model.id));
					const stillEnabled = [...activeEnabledIds].filter((id) => freshIds.has(id));
					const upstreamImages = fresh.filter((model) => imageDefaultFor(model)).map((model) => model.id);
					const stillBudgets = {};
					for (const id of freshIds) {
						const budget = activeContextBudgets[id];
						if (typeof budget === "number") stillBudgets[id] = budget;
					}
					setDrafts((prev) => ({
						...prev,
						[activeRegion]: {
							models: fresh,
							enabledIds: new Set(stillEnabled),
							imageIds: new Set(upstreamImages),
							offIds: new Set(activeOffIds),
							contextBudgets: stillBudgets
						}
					}));
				} catch (error) {
					if (mounted.current) setStatusByRegion((prev) => ({
						...prev,
						[activeRegion]: {
							...prev[activeRegion],
							status: "error",
							message: error instanceof Error ? error.message : t("row.requestFailed")
						}
					}));
				} finally {
					if (mounted.current) setBusy(false);
				}
			};
			const draft = drafts[activeRegion];
			const visibleModels = draft?.models ?? (status.status === "signed-in" ? status.models : []);
			const savedEnabledIds = status.status === "signed-in" ? new Set(status.enabledModelIds) : /* @__PURE__ */ new Set();
			const activeEnabledIds = draft?.enabledIds ?? savedEnabledIds;
			const savedImageIds = status.status === "signed-in" ? new Set(status.imageModelIds) : /* @__PURE__ */ new Set();
			const activeImageIds = draft?.imageIds ?? savedImageIds;
			const savedOffIds = status.status === "signed-in" ? new Set(status.offModelIds) : /* @__PURE__ */ new Set();
			const activeOffIds = draft?.offIds ?? savedOffIds;
			settingsScope?.getSnapshot().value;
			const savedContextBudgets = status.status === "signed-in" ? status.contextBudgets ?? {} : {};
			const activeContextBudgets = draft?.contextBudgets ?? savedContextBudgets;
			const dirty = draft !== void 0;
			/**
			* Whether the card's inputs accept edits.
			*
			* Deliberately NOT the settings scope's own `writable` flag: on the affected
			* DSH 0.1.7 deployment that flag stays false (the scope initialises it false
			* and only raises it once its mirror loads as a Host-backed form), which left
			* every input `disabled` — clicking them did nothing at all. Writes no longer
			* depend on that flag: `writeField` tries the scope and falls back to the
			* plugin's own Host endpoint, which performs the mutate in the Host process.
			* A bound scope is therefore all that is required to accept an edit.
			*/
			const canWrite = settingsScope !== void 0;
			const editDraft = (edit) => {
				setDrafts((prev) => ({
					...prev,
					[activeRegion]: edit(prev[activeRegion] ?? {
						models: [...visibleModels],
						enabledIds: new Set(activeEnabledIds),
						imageIds: new Set(activeImageIds),
						offIds: new Set(activeOffIds),
						contextBudgets: { ...activeContextBudgets }
					})
				}));
			};
			const toggleModel = (modelId) => {
				editDraft((current) => {
					const next = new Set(current.enabledIds);
					if (!next.delete(modelId)) next.add(modelId);
					return {
						...current,
						enabledIds: next
					};
				});
			};
			const toggleImage = (modelId) => {
				editDraft((current) => {
					const next = new Set(current.imageIds);
					if (!next.delete(modelId)) next.add(modelId);
					return {
						...current,
						imageIds: next
					};
				});
			};
			/**
			* Flip one row's `off` answer (issue #34).
			*
			* Writes an EXPLICIT answer in both directions, so the built-in rule is only
			* consulted while the user has no opinion. That is also why there is no
			* "reset" control: once an answer matches the rule, the two are
			* indistinguishable in effect, and the tooltip already names the override.
			*/
			const toggleOff = (modelId) => {
				editDraft((current) => {
					const next = new Set(current.offIds);
					if (!next.delete(modelId)) next.add(modelId);
					return {
						...current,
						offIds: next
					};
				});
			};
			const setContextBudget = (modelId, budget) => {
				editDraft((current) => ({
					...current,
					contextBudgets: {
						...current.contextBudgets,
						[modelId]: budget
					}
				}));
			};
			const discardModels = () => {
				setDrafts((prev) => {
					const next = { ...prev };
					delete next[activeRegion];
					return next;
				});
			};
			/**
			* Probe one or more models with a single minimal request each.
			*
			* The Host owns the request: the browser half sends only model ids and gets
			* outcomes back, because the credential must never cross to the page. The
			* route runs the batch sequentially and this waits for the whole answer, which
			* is what lets the card report every row at once — a per-row response would
			* race the shared `probing` map and make the batch button's state unknowable.
			*
			* Probing is deliberately independent of `dirty`: a test answers "does this
			* model work right now", which is true of the SAVED selection and the draft
			* alike, and blocking it on unsaved edits would make the button dead exactly
			* when the user is deciding what to keep.
			*/
			const probeModels = async (modelIds) => {
				if (modelIds.length === 0) return;
				setProbeError(void 0);
				setProbing((previous) => {
					const next = { ...previous };
					for (const id of modelIds) next[id] = true;
					return next;
				});
				try {
					const response = await fetch(withWorkBuddyRegion(WORKBUDDY_PROBE_PATH, activeRegion), {
						method: "POST",
						headers: {
							"content-type": "application/json",
							accept: "application/json"
						},
						credentials: "same-origin",
						body: JSON.stringify({ modelIds })
					});
					const body = await response.json().catch(() => void 0);
					if (!response.ok || !Array.isArray(body?.results)) throw new Error(body?.error ?? `HTTP ${String(response.status)}`);
					if (!mounted.current) return;
					setProbes((previous) => {
						const regionResults = { ...previous[activeRegion] ?? {} };
						for (const result of body.results) regionResults[result.modelId] = result;
						return {
							...previous,
							[activeRegion]: regionResults
						};
					});
				} catch (error) {
					if (mounted.current) setProbeError(error instanceof Error ? error.message : t("row.requestFailed"));
				} finally {
					if (mounted.current) setProbing((previous) => {
						const next = { ...previous };
						for (const id of modelIds) delete next[id];
						return next;
					});
				}
			};
			const saveModels = async () => {
				if (settingsScope === void 0) return;
				if (status.status !== "signed-in") return;
				setSaving(true);
				setSaveError(void 0);
				try {
					await writeRegionModels(settingsScope, status.region, {
						enabled: activeRegionOn,
						lastCatalog: visibleModels.map(toPersistedWorkBuddyModel),
						enabledModelIds: [...activeEnabledIds],
						imageModelIds: [...activeImageIds],
						offModelIds: [...activeOffIds],
						contextBudgets: activeContextBudgets
					});
					discardModels();
					await refreshUsage(activeRegion);
				} catch (error) {
					if (mounted.current) {
						const reason = error instanceof Error ? error.message : t("row.requestFailed");
						setSaveError(isFileContentionWriteError(error) ? `${reason}${t("row.saveContentionHint")}` : reason);
					}
				} finally {
					if (mounted.current) setSaving(false);
				}
			};
			const title = t("row.title");
			/**
			* Show a name, or a placeholder when the desktop app recorded none.
			*
			* The Host sends `''` rather than an identifier, because a `uin`/`uid` shown
			* where a name belongs reads as "the plugin does not know who this is" — the
			* placeholder says the honest thing instead.
			*/
			const nameOf = (value) => value === "" ? t("row.accountUnnamed") : value;
			/** The saved choice no longer matches a local sign-in (tokens are fine). */
			const selectionLost = status.status === "signed-out" && status.selectionLost === true;
			/**
			* The paths the Host probed, on the branch where nothing was found at all.
			* Absent on the legacy card payload (an older Host), so it defaults empty
			* rather than rendering an empty diagnostic.
			*/
			const searched = status.status === "signed-out" ? status.searched ?? [] : [];
			/**
			* What the signed-out paragraph says, and whether to append the Host's raw
			* error. The rule lives in `./searched-paths.ts` because it is the fix for a
			* real duplication: `resolve()`'s message already enumerated every path, and
			* the list below enumerates them again with better reasons.
			*/
			const notice = signedOutNotice({
				selectionLost,
				message: status.status === "signed-out" ? status.message : void 0,
				searched
			});
			status.status === "error" || status.selectionExplicit;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: `dsm-plugin-card${open ? " dsm-plugin-card-open" : ""}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dsm-plugin-card-header",
					"aria-expanded": open,
					"aria-label": `${t(open ? "row.collapse" : "row.expand")}: ${title}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							className: "dsm-plugin-card-icon",
							src: WORKBUDDY_PLUGIN_ICON,
							alt: ""
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsm-plugin-card-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-plugin-card-title",
								children: title
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-plugin-card-description",
								children: t("row.desc")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"aria-hidden": "true",
							className: `dsm-plugin-card-chevron${open ? " dsm-plugin-card-chevron-open" : ""}`
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-plugin-card-body",
					hidden: !open,
					children: open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-workbuddy-usage",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-workbuddy-tabs",
								role: "tablist",
								"aria-label": title,
								children: WORKBUDDY_REGIONS.map((region) => {
									const regionStatus = statusByRegion[region];
									const regionOnState = regionOn(region);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-tab-cell",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											role: "tab",
											"aria-selected": region === activeRegion,
											className: `dsm-workbuddy-tab${region === activeRegion ? " dsm-workbuddy-tab-active" : ""}${regionOnState ? "" : " dsm-workbuddy-tab-off"}`,
											onClick: () => {
												setActiveRegion(region);
												setAccountError(void 0);
											},
											children: [regionStatus === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												"aria-hidden": "true",
												className: "dsm-workbuddy-tab-dot",
												style: dotStyle(regionStatus.status)
											}), region === "cn" ? t("row.tabCn") : t("row.tabGlobal")]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											className: "dsm-workbuddy-tab-switch",
											title: t("row.tabSwitchHint"),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												checked: regionOnState,
												disabled: togglingRegion === region || !canWrite || saving || poolBusy,
												"aria-label": t("row.tabSwitchAria", { region: region === "cn" ? t("row.tabCn") : t("row.tabGlobal") }),
												onChange: (event) => {
													toggleRegion(region, event.target.checked);
												}
											})
										})]
									}, region);
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-models-summary",
								children: t("row.tabHint")
							}),
							!activeRegionOn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-tab-off-notice",
								children: t("row.tabOffNotice")
							}) : null,
							status.status === "error" || status.status === "signed-in" && status.creditsError !== void 0 ? status.status === "signed-in" && status.credentialRejected === true ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-usage-hint",
								children: t("row.reloginHint")
							}) : null,
							selectionLost ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-usage-hint",
								children: t("row.selectionLostHint")
							}) : null,
							status.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								status.credentialRejected === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: "dsm-workbuddy-usage-error",
									role: "alert",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("row.credentialRejectedTitle") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("row.credentialRejectedIntro", { accountName: nameOf(status.accountName) }) }),
										status.recovery?.usableAccount !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("row.credentialRejectedSwitch", { accountName: nameOf(status.recovery.usableAccount.accountName) }) }) : status.recovery?.reloginRequired === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("row.credentialRejectedRelogin") }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("row.credentialRejectedChoose") }),
										status.recovery?.usableAccount === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dsm-btn dsm-btn-outline",
											disabled: switchingAccount || !canWrite,
											onClick: () => {
												const target = status.recovery?.usableAccount;
												if (target !== void 0) switchAccount(target.accountId);
											},
											children: switchingAccount ? t("row.accountsScanning") : t("row.credentialRejectedSwitchAction", { accountName: nameOf(status.recovery.usableAccount.accountName) })
										})
									]
								}) : null,
								status.creditsError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-workbuddy-usage-error",
									children: t("row.creditsError", { message: status.creditsError })
								}),
								status.refreshError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-workbuddy-usage-error",
									role: "alert",
									children: t("row.requestFailedHint", { message: status.refreshError })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountPool, {
									t,
									region: activeRegion,
									...status.pool === void 0 ? {} : { pool: status.pool },
									...settingsScope === void 0 ? {} : { settingsScope },
									onRescan: () => {
										rescanAccounts();
									},
									rescanning: busy,
									onSelectAccount: (accountId) => {
										switchAccount(accountId);
									},
									selectingAccount: switchingAccount,
									siblingBusy: saving || togglingRegion !== void 0,
									onBusyChange: setPoolBusy,
									onSaved: async () => await refreshUsage(activeRegion) !== void 0,
									onRefresh: () => {
										refreshUsage(activeRegion);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
									className: "dsm-workbuddy-models",
									"aria-label": t("row.modelsTitle"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-models-fold",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsm-workbuddy-models-head",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "dsm-workbuddy-models-title-row",
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
														className: "dsm-workbuddy-models-title",
														children: [t("row.modelsTitle"), dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-workbuddy-models-dirty",
															children: t("row.modelsDirty")
														}) : null]
													})
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													className: "dsm-workbuddy-models-summary",
													children: t("row.modelsSummary", { count: activeEnabledIds.size })
												})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "dsm-workbuddy-models-head-actions",
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-btn dsm-btn-outline",
														disabled: busy,
														onClick: () => {
															refreshModels();
														},
														children: busy ? t("row.modelsRefreshing") : t("row.modelsRefresh")
													})
												})]
											}),
											probeError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "dsm-workbuddy-model-probe-result dsm-workbuddy-model-probe-result-bad",
												role: "alert",
												children: t("row.probeError", { message: probeError })
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dsm-workbuddy-model-list",
												children: visibleModels.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: `dsm-workbuddy-model${activeEnabledIds.has(model.id) ? "" : " dsm-workbuddy-model-disabled"}`,
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: "dsm-workbuddy-model-head",
															children: [
																/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
																	className: "dsm-workbuddy-model-enabled",
																	children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																		type: "checkbox",
																		checked: activeEnabledIds.has(model.id),
																		disabled: !canWrite || saving,
																		onChange: () => {
																			toggleModel(model.id);
																		}
																	}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "dsm-workbuddy-model-copy",
																		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																			className: "dsm-workbuddy-model-name",
																			children: [model.name, model.creditMultiplier === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																				className: "dsm-workbuddy-model-name-rate",
																				children: [
																					"(",
																					model.creditMultiplier.toFixed(2),
																					"x)"
																				]
																			})]
																		})
																	})]
																}),
																/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
																	className: "dsm-workbuddy-model-image",
																	title: imageCheckboxHint(model, t),
																	children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																		type: "checkbox",
																		checked: activeImageIds.has(model.id),
																		disabled: !canWrite || saving,
																		onChange: () => {
																			toggleImage(model.id);
																		}
																	}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.modelImage") })]
																}),
																/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
																	className: "dsm-workbuddy-model-off",
																	title: t("row.modelOffHint"),
																	children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																		type: "checkbox",
																		checked: activeOffIds.has(model.id),
																		disabled: !canWrite || saving,
																		onChange: () => {
																			toggleOff(model.id);
																		}
																	}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.modelOff") })]
																}),
																/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
																	className: "dsm-workbuddy-context-budget",
																	"aria-label": t("row.contextBudget"),
																	children: [
																		model.nativeContextWindow > 2e5 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																			type: "radio",
																			name: `context-${model.id}`,
																			checked: (activeContextBudgets[model.id] ?? 2e5) === 2e5,
																			disabled: !canWrite || saving,
																			onChange: () => {
																				setContextBudget(model.id, 2e5);
																			}
																		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "200K" })] }) : null,
																		model.nativeContextWindow > 5e5 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																			type: "radio",
																			name: `context-${model.id}`,
																			checked: activeContextBudgets[model.id] === 5e5,
																			disabled: !canWrite || saving,
																			onChange: () => {
																				setContextBudget(model.id, 5e5);
																			}
																		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "500K" })] }) : null,
																		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																			type: "radio",
																			name: `context-${model.id}`,
																			checked: model.nativeContextWindow <= 2e5 || activeContextBudgets[model.id] === model.nativeContextWindow,
																			disabled: model.nativeContextWindow <= 2e5 || !canWrite || saving,
																			onChange: () => {
																				setContextBudget(model.id, model.nativeContextWindow);
																			}
																		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatCapacity(model.nativeContextWindow, t("row.modelUnknown")) })] })
																	]
																}),
																/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
																	className: "dsm-workbuddy-model-actions-buttons",
																	children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																		type: "button",
																		className: "dsm-btn dsm-btn-outline dsm-workbuddy-model-probe",
																		disabled: probing[model.id] === true || status.status !== "signed-in",
																		title: t("row.probeHint"),
																		onClick: () => {
																			probeModels([model.id]);
																		},
																		children: probing[model.id] === true ? t("row.probing") : t("row.probe")
																	})
																})
															]
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
															className: "dsm-workbuddy-model-details",
															children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																className: "dsm-workbuddy-model-meta",
																children: [
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.modelContext", { context: formatCapacity(model.nativeContextWindow, t("row.modelUnknown")) }) }),
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.modelOutput", { output: formatCapacity(model.maxTokens, t("row.modelUnknown")) }) }),
																	model.reasoning === void 0 || model.reasoning.supportedEfforts === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("row.modelReasoning", { efforts: model.reasoning.supportedEfforts.join(" / ") }) })
																]
															})
														}),
														(() => {
															const result = probes[activeRegion]?.[model.id];
															if (result === void 0) return null;
															const view = probeResultView(result, t);
															const reason = inlineProbeReason(result.outcome, result.message);
															return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
																className: `dsm-workbuddy-model-probe-result dsm-workbuddy-model-probe-result-${view.tone}`,
																role: "status",
																...result.message === void 0 ? {} : { title: result.message },
																children: [view.text, reason === void 0 ? null : " · " + reason]
															});
														})()
													]
												}, model.id))
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "dsm-workbuddy-model-capability-note",
												children: t("row.modelCapabilityPending")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsm-workbuddy-model-actions",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
														className: "dsm-workbuddy-usage-cheer",
														href: WORKBUDDY_GITHUB_URL,
														target: "_blank",
														rel: "noopener noreferrer",
														children: [t("row.cheer"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-workbuddy-usage-cheer-star",
															"aria-hidden": "true",
															children: "★"
														})]
													}),
													saveError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-model-save-error",
														children: t("row.saveError", { message: saveError })
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsm-workbuddy-model-actions-buttons",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: "dsm-btn dsm-btn-outline",
															disabled: !dirty || saving || poolBusy || togglingRegion !== void 0,
															onClick: discardModels,
															children: t("row.discard")
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: "dsm-btn dsm-btn-primary",
															disabled: !dirty || saving || poolBusy || togglingRegion !== void 0 || activeEnabledIds.size === 0,
															onClick: () => {
																saveModels();
															},
															children: saving ? t("row.saving") : t("row.save")
														})]
													})
												]
											})
										]
									})
								})
							] }) : null,
							status.status === "signed-out" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-workbuddy-usage-text",
									children: signedOutText(notice, t)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsm-workbuddy-usage-account-actions",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-btn dsm-btn-outline",
										disabled: busy,
										onClick: () => {
											rescanAccounts();
										},
										children: busy ? t("row.accountsScanning") : t("row.accountsRescan")
									})
								}),
								searched.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchedPaths, {
									items: searched,
									t
								}) : null
							] }) : null,
							status.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-usage-error",
								children: status.message
							}) : null
						]
					}) : null
				})]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Plugin-card copy registered under the settings.workbuddy locale namespace.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — `row.*` 的文案键约定与中英 1:1 键对齐（`zh: Record<Key, string>`
		*     强制双语同步）来自该项目，其又继承自
		*     dingminhua/dsh-subagent-default-model（MIT）。
		* 改动：文案按 WorkBuddy 的实际情况改写（积分套餐、模型倍率、多账号）。
		*
		* @module dsh-connect-workbuddy/client/locales
		*/
		const en = {
			"row.title": "WorkBuddy credits & models (dsh-connect-workbuddy)",
			"row.desc": "Use WorkBuddy models in DSH and see your remaining credits; the domestic and international sides are two independent providers, each with its own account — use both at the same time.",
			"row.expand": "Expand",
			"row.collapse": "Collapse",
			"row.tabCn": "Domestic",
			"row.tabGlobal": "Global",
			"row.tabHint": "Each tab is a separate provider (workbuddy / workbuddy-global) with its own account, credits, and models. Both sides are live at once: different sessions can pick from either side, and changes on one tab never touch the other.",
			"row.tabSwitchHint": "Uncheck to switch this provider off. Its models disappear from the DSH model picker; your account, credits, and model settings are kept and return when you check it again.",
			"row.tabSwitchAria": "Offer the {region} provider to DSH",
			"row.tabOffNotice": "This provider is switched off: none of its models are offered to DSH. Your account, credits, and model settings are kept — check the box above the tab to bring it back.",
			"row.signedOutHint": "Sign in once in the WorkBuddy desktop app; this plugin follows that sign-in automatically.",
			"row.signedOutWrongRegion": "Your WorkBuddy sign-in was found, but it belongs to the other region tab. Switch tabs above to use it — there is nothing to sign in again.",
			"row.signedOutEncrypted": "Your WorkBuddy sign-in is present, but its token fields are encrypted and the plugin could not read the key. Install the WorkBuddy desktop app, or set WORKBUDDY_APP_EXECUTABLE to its executable — signing in again will not change this.",
			"row.searchedTitle": "Paths checked",
			"row.searchedHint": "If your WorkBuddy keeps its login somewhere else, point the plugin at it with the WORKBUDDY_AUTH_FILE environment variable.",
			"row.reasonMissing": "not found",
			"row.reasonUnreadable": "unreadable",
			"row.reasonInvalid": "no usable token",
			"row.reasonEncrypted": "encrypted — needs the desktop app",
			"row.reasonWrongRegion": "belongs to the other region",
			"row.sourceDesktop": "desktop app",
			"row.sourceDsh": "plugin copy",
			"row.searchedMore": "Show the {count} path(s) that were not found",
			"row.reloginHint": "If errors occur, sign back in to the WorkBuddy app.",
			"row.credentialRejectedTitle": "WorkBuddy refused this account's token",
			"row.credentialRejectedIntro": "The token for \"{accountName}\" is no longer accepted by the upstream, so credits and check-in are unavailable. Signing in again only helps if the problem is the token itself — here is what actually applies:",
			"row.credentialRejectedSwitch": "Another sign-in on this machine answered the upstream: \"{accountName}\". Switching to it fixes this — no need to sign in again.",
			"row.credentialRejectedSwitchAction": "Switch to \"{accountName}\"",
			"row.credentialRejectedRelogin": "No other local sign-in exists to switch to. Sign in again in the WorkBuddy desktop app.",
			"row.credentialRejectedChoose": "Other local sign-ins exist but none of them answered the upstream just now. Try switching to one above; if none works, sign in again in the desktop app.",
			"row.requestFailed": "Request failed",
			"row.requestFailedHint": "Refresh failed — showing the last loaded data: {message}",
			"row.poolErrUnavailable": "The account pool is not available in this build (or its batch route is missing). Restart the app; if it persists, the plugin needs reinstalling.",
			"row.poolErrFailed": "The batch failed on the host side: {message}",
			"row.poolErrHttp": "The batch was refused (HTTP {status}). Check the plugin is up to date and try again.",
			"row.poolErrNoMembers": "No account is checked into this pool — the batch had nothing to run. Check at least one account and save.",
			"row.poolErrNoLiveMembers": "Every account checked into this pool has lost its local sign-in, so the batch had nothing to run. Sign in again in the WorkBuddy desktop app, or save to drop them.",
			"row.poolErrNoFreeModel": "This region has no zero-multiplier model to test with. Refresh the model catalog, or pick a target model yourself.",
			"row.poolErrNoCheckin": "This region has no daily check-in — the action is not offered here.",
			"row.poolErrStaleModel": "The target model is no longer offered by this region. Pick another, or switch back to automatic.",
			"row.creditsError": "Credit query unavailable: {message}",
			"row.refresh": "Refresh",
			"row.refreshing": "Refreshing…",
			"row.accountUnnamed": "Unnamed account",
			"row.accountsHint": "Choose from locally detected sign-ins. Tokens are never shown or saved in DSH settings.",
			"row.accountsRescan": "Detect accounts again",
			"row.accountsScanning": "Detecting…",
			"row.accountsWriteFailed": "The account change was not saved: {message} — the active profile's configuration file could not be updated (on Windows it may be locked by an antivirus scanner or a sync client). Your previous choice is still in effect; close whatever holds that file and try again (see docs/WINDOWS.md in the plugin repo for the exact path).",
			"row.selectionLostHint": "The saved account no longer exists locally.",
			"row.selectionLostMessage": "The account saved for this region is no longer among the local sign-ins (WorkBuddy replaced its login or cleaned up backups). Your other sign-ins are fine — pick a current one from the list above. Signing in again in the desktop app will not fix this.",
			"row.modelsTitle": "Models",
			"row.modelsSummary": "{count} enabled",
			"row.modelsDirty": "unsaved changes",
			"row.modelsRefresh": "Refresh from WorkBuddy",
			"row.modelsRefreshing": "Refreshing models…",
			"row.discard": "Discard changes",
			"row.save": "Save",
			"row.saving": "Saving…",
			"row.saveError": "Save failed: {message}",
			"row.saveContentionHint": " (The file was locked, so the write was refused — on Windows this is usually an antivirus scanner, a sync client such as OneDrive, or an editor with that file open. Close whatever holds it and save again; your edits are still here.)",
			"row.modelContext": "Maximum context {context}",
			"row.contextBudget": "DSH context budget",
			"row.modelOutput": "Output {output}",
			"row.modelRate": "{rate}x credits",
			"row.modelMultimodal": "Multimodal",
			"row.modelImage": "Image",
			"row.modelImageText": "Image input: the vendor documents this model as text-only, so a refresh leaves it unchecked. Tick it yourself only if you know it reads images.",
			"row.modelImageUnverified": "Image input unverified: no vendor source confirms this model reads images, so a refresh leaves it unchecked rather than guessing. Tick it yourself if you have verified it works.",
			"row.modelOff": "Can disable",
			"row.modelOffHint": "Offer the “off” level for this model",
			"row.modelReasoning": "Reasoning: {efforts}",
			"row.modelUnknown": "Unknown",
			"row.modelCapabilityPending": "Only capabilities advertised by WorkBuddy are shown.",
			"row.probe": "Test",
			"row.probing": "Testing…",
			"row.probeHint": "Send a real-volume request (~25k input tokens) to this model and report whether it answers right now. The upstream rate limit fires on request SIZE — measured: about 20k tokens pass, about 30k are refused — so a small request can look fine while every long-conversation request is refused. This is why every test costs real credits (about 0.7) and runs one model at a time.",
			"row.probeOk": "✓ Usable",
			"row.probeOkMs": "✓ Usable ({ms})",
			"row.probeRateLimitedUnknown": "✗ Rate limited · the upstream gave no time for when it frees up",
			"row.probeRateLimitedAt": "✗ Rate limited · usable again after {at}",
			"row.probeOutOfCreditUnknown": "✗ Not enough credits · the upstream gave no time for when it frees up",
			"row.probeOutOfCreditAt": "✗ Not enough credits · quota refreshes {at}",
			"row.probeCredentialRejected": "✗ WorkBuddy refused this account's token — sign in again or pick another account",
			"row.probePolicyRejected": "✗ WorkBuddy's server refused this request under its content policy — re-signing in won't help; try the desktop app or another region/account",
			"row.probeNotFound": "✗ The upstream does not know this model",
			"row.probeUnavailable": "✗ The upstream could not be reached — no usable answer came back",
			"row.probeFailed": "✗ Test failed",
			"row.probeFailedStatus": "✗ Test failed (HTTP {status})",
			"row.probeError": "Could not run the test: {message}",
			"row.cheer": "Star on GitHub",
			"row.poolTitle": "Account pool",
			"row.poolNoCandidate": "No account in this pool can be used right now.",
			"row.poolNoCandidateHint": "Members are rate-limited, out of credits, rejected, or unreachable. Rate limits, drained quotas and transient failures return to the pool on their own — at the time the upstream states, or after a 30-minute fallback. Only a rejected credential needs a new sign-in.",
			"row.poolCheckinAll": "Check in all accounts",
			"row.poolCheckingIn": "Checking in…",
			"row.poolTestAll": "Test all accounts",
			"row.poolTesting": "Testing…",
			"row.poolBusyHint": "Running one account at a time…",
			"row.poolTargetAuto": "Auto",
			"row.poolTargetStaleShort": "target model unavailable",
			"row.poolTargetNoneShort": "no free model",
			"row.poolTargetFree": "Auto-picked free model: {model}",
			"row.poolTargetPreferred": "Your chosen model: {model}",
			"row.poolTargetCurrentPreferred": "Current: {model} (your choice).",
			"row.poolTargetCurrentFree": "Current: {model} (auto-picked free model).",
			"row.poolTargetNone": "This region has no zero-multiplier model yet.",
			"row.poolTargetStale": "The target model you saved is no longer offered: {model}",
			"row.poolTargetStaleHint": "The region's catalog changed and no longer lists this model, so testing is off rather than running against a model the upstream may not accept. Pick another target, or switch back to automatic.",
			"row.poolTargetStaleClear": "Switch back to automatic",
			"row.poolTargetStaleOption": "{model} (no longer offered)",
			"row.poolTargetNoneHint": "The domestic catalog only reveals its multipliers after a model refresh. Rather than quietly spending credits on a paid model, testing stays off until one appears — refresh the models, or pick a target model yourself.",
			"row.poolColumnAccount": "Account",
			"row.poolColumnCredits": "Credits",
			"row.poolColumnProbe": "Target model",
			"row.poolColumnCheckin": "Check-in",
			"row.poolNeverTested": "Not tested yet",
			"row.poolTestedAt": "Tested {at}",
			"row.poolCheckedIn": "Checked in",
			"row.poolNotCheckedIn": "Not checked in",
			"row.poolCheckinUnknown": "—",
			"row.poolCreditSoon": "{count} expiring within 3 days",
			"row.poolCreditNearest": "Nearest package expires {at}",
			"row.poolExcludedRateLimited": "Rate limited",
			"row.poolExcludedOutOfCredit": "Out of credits",
			"row.poolExcludedRejected": "Rejected",
			"row.poolExcludedUnusable": "Unusable",
			"row.poolRetryAt": "Back after {at}",
			"row.poolRetryUnknown": "The upstream gave no time for when this frees up",
			"row.remainingImminent": "any moment now",
			"row.remainingMinutes": "in about {count} min",
			"row.remainingHours": "in about {count} h",
			"row.remainingDays": "in about {count} d",
			"row.poolProbeJustNow": "just now",
			"row.poolProbeMinutesAgo": "{count} min ago",
			"row.poolProbeHoursAgo": "{count} h ago",
			"row.poolProbeDaysAgo": "{count} d ago",
			"row.poolProbeSourceTest": "tested",
			"row.poolProbeSourceLive": "hit by a live request",
			"row.poolProbeSourceUnknown": "source unknown",
			"row.poolSettingsTitle": "Account pool settings",
			"row.poolSettingsHint": "These are preferences: they take effect when you save (same as the model list). Test results are written automatically and are not affected by this button.",
			"row.poolEnabled": "Enable the account pool",
			"row.poolEnabledHint": "While on, this region's pool decides who serves every request (usable first, then credits, soonest-expiring, freshest credential) and retries on another account when one fails. While off, the plugin does not pick or switch: the account you selected serves every request and a failure is reported as-is. Check-in and testing are MANUAL actions and stay available either way — the switch only controls whether the plugin decides by itself.",
			"row.poolManualAccountLabel": "Account in use",
			"row.poolManualAccountHint": "Which account serves this region while the pool is off. Turn the pool on and the ranking picks instead.",
			"row.poolManualAccountNone": "No account in effect",
			"row.poolTargetLabel": "Target test model",
			"row.poolTargetHint": "Auto (default) picks a zero-multiplier model from this region's catalog, preferring the largest context window. The two regions can pick different models. A manual choice always wins.",
			"row.poolTargetAutoOption": "Auto — pick a free model",
			"row.poolProbeSizeLabel": "Test request size",
			"row.poolProbeSizeHint": "How much text a test sends. The upstream refuses a request once it grows past roughly 20K–30K tokens, so a test smaller than your real conversations answers \"usable\" for an account that would refuse them. Bigger tests are more truthful but cost more credit each.",
			"row.poolProbeSizeDefault": "Default (25K)",
			"row.poolProbeSizeOption": "{tokens}K tokens",
			"row.poolSaved": "Save",
			"row.poolSaving": "Saving…",
			"row.poolSaveFailed": "Could not save: {message}",
			"row.poolSavedStaleRefresh": "Saved, but the panel could not re-read it. The value is stored; the next refresh will show it.",
			"row.poolDiscard": "Discard changes",
			"row.poolDirty": "● Unsaved changes",
			"row.poolManualUnlock": "Turn off rotation",
			"row.poolLogTitle": "Activity",
			"row.poolLogClear": "Clear",
			"row.poolLogEmpty": "Nothing yet. Check-ins, tests, and account switches are recorded here.",
			"row.poolLogCheckinStart": "Checking in {count} account(s), one at a time",
			"row.poolLogCheckinClaimed": "{accountName}: checked in (+{credit})",
			"row.poolLogCheckinAlready": "{accountName}: already checked in today — skipped",
			"row.poolLogCheckinFailed": "{accountName}: check-in failed — {message}",
			"row.poolLogCheckinDone": "Check-in finished",
			"row.poolLogBatchFailed": "Batch failed — nothing ran: {message}",
			"row.poolLogTestStart": "Testing {count} account(s) against {model}",
			"row.poolLogTestRow": "{accountName}: {outcome}",
			"row.poolLogTestDone": "Test finished; the pool was re-ranked",
			"row.poolLogTestRowMalformed": "{accountName}: the host returned no result for this account",
			"row.poolRegionNote": "The domestic and international pools are fully independent: accounts, switches, intervals, and target models never affect each other.",
			"row.poolMembersTitle": "Accounts in this pool",
			"row.poolMembersHint": "Only checked accounts are checked in, tested, and used for rotation. Nothing is selected by default — check the ones you want, then save.",
			"row.poolSelectAll": "Select all",
			"row.poolSelectNone": "Clear all",
			"row.poolSelectedCount": "{count} of {total} selected",
			"row.poolNoneSelected": "No account is checked into this pool.",
			"row.poolNoneSelectedHint": "Check at least one account above and save. Until then both buttons stay disabled, because a pool with no members has nothing to run on.",
			"row.poolGhostMembers": "{count} saved account(s) are no longer signed in on this machine, so they are not counted and not used. Save again to drop them.",
			"row.poolSelectAria": "Include {accountName} in this region's account pool",
			"row.poolMember": "In pool",
			"row.poolCurrentBadge": "In use",
			"row.poolCurrentHeader": "In use: {account}",
			"row.poolNotMember": "Not in pool",
			"row.poolUnsavedMembers": "Selection changed — save to apply"
		};
		const zh = {
			"row.title": "接入使用 WorkBuddy 积分与模型（dsh-connect-workbuddy）",
			"row.desc": "在 DSH 中使用 WorkBuddy 模型并随时查看剩余积分；国内版与国际版是两个独立供应商，各有自己的账号，可同时使用。",
			"row.expand": "展开",
			"row.collapse": "收起",
			"row.tabCn": "国内版",
			"row.tabGlobal": "国际版",
			"row.tabHint": "每个 tab 是一个独立供应商（workbuddy / workbuddy-global），各有自己的账号、积分与模型。两边同时生效：不同会话可各选一边，一侧的改动不影响另一侧。",
			"row.tabSwitchHint": "取消勾选即关闭该供应商：它的模型不再出现在 DSH 模型选择器里；账号、积分与模型设置都会保留，重新勾选即恢复。",
			"row.tabSwitchAria": "是否向 DSH 提供{region}供应商",
			"row.tabOffNotice": "该供应商已关闭：它的模型不会提供给 DSH。账号、积分与模型设置均已保留——勾选上方复选框即可恢复。",
			"row.signedOutHint": "在 WorkBuddy 桌面 App 里登录一次即可，插件会自动跟随当前登录的账号。",
			"row.signedOutWrongRegion": "找到了你的 WorkBuddy 登录信息，但它属于另一个地区的标签页。切换到上方对应标签页即可使用——不需要重新登录。",
			"row.signedOutEncrypted": "你的 WorkBuddy 登录信息在，但其中的 token 字段是加密的，插件拿不到密钥。请安装 WorkBuddy 桌面 App，或用环境变量 WORKBUDDY_APP_EXECUTABLE 指定它的可执行文件——重新登录无法解决这个问题。",
			"row.searchedTitle": "已检查的路径",
			"row.searchedHint": "如果你的 WorkBuddy 把登录信息存在别处，可以用环境变量 WORKBUDDY_AUTH_FILE 指定。",
			"row.reasonMissing": "不存在",
			"row.reasonUnreadable": "无法读取",
			"row.reasonInvalid": "没有可用的 token",
			"row.reasonEncrypted": "已加密——需要桌面 App",
			"row.reasonWrongRegion": "属于另一个地区",
			"row.sourceDesktop": "桌面 App",
			"row.sourceDsh": "插件副本",
			"row.searchedMore": "显示另外 {count} 条「不存在」的路径",
			"row.reloginHint": "出现错误，重新登录 WorkBuddy APP 即可。",
			"row.credentialRejectedTitle": "WorkBuddy 拒绝了这个账号的 token",
			"row.credentialRejectedIntro": "「{accountName}」的 token 已不被上游接受，所以积分与签到都用不了。重新登录只在「确实是 token 的问题」时才有用——当前实际适用的是下面这一条：",
			"row.credentialRejectedSwitch": "本机另一个账号「{accountName}」刚刚实测可用，切换到它即可恢复，不必重新登录。",
			"row.credentialRejectedSwitchAction": "切换到「{accountName}」",
			"row.credentialRejectedRelogin": "本机没有其他账号可切换。请在 WorkBuddy 桌面端重新登录。",
			"row.credentialRejectedChoose": "本机还有其他账号，但刚才都没能通过上游校验。可以在上方切换一个试试；如果都不行，请在桌面端重新登录。",
			"row.requestFailed": "请求失败",
			"row.requestFailedHint": "刷新失败——下方为上次加载的数据：{message}",
			"row.poolErrUnavailable": "本版本没有可用的账号池（或其批量接口缺失）。请重启应用；若仍不行，插件可能需要重新安装。",
			"row.poolErrFailed": "批量操作在宿主侧失败：{message}",
			"row.poolErrHttp": "批量操作被拒绝（HTTP {status}）。请确认插件是最新版本后重试。",
			"row.poolErrNoMembers": "本池没有勾选任何账号，批量操作没有可执行对象。请至少勾选一个账号并保存。",
			"row.poolErrNoLiveMembers": "本池勾选的账号在本机都已不再登录，批量操作没有可执行对象。请在 WorkBuddy 桌面端重新登录，或保存以移除它们。",
			"row.poolErrNoFreeModel": "本区域没有可用的免费（倍率为 0）模型。请先刷新模型目录，或自己指定一个目标模型。",
			"row.poolErrNoCheckin": "本区域没有每日签到 —— 这里不提供该操作。",
			"row.poolErrStaleModel": "目标模型已不在本区域目录中。请改选一个，或切回自动。",
			"row.creditsError": "积分查询失败：{message}",
			"row.refresh": "刷新",
			"row.refreshing": "正在刷新…",
			"row.accountUnnamed": "未命名账号",
			"row.accountsHint": "选择本机检测到的登录账号；Token 不会显示，也不会保存到 DSH 设置。",
			"row.accountsRescan": "重新检测账号",
			"row.accountsScanning": "正在检测…",
			"row.accountsWriteFailed": "账号改动未保存：{message} —— 当前 profile 的配置文件写入失败（Windows 上可能被杀毒软件或同步盘占用）。当前仍是原来保存的选择，请先关闭占用该文件的程序再重试（文件的确切路径见插件仓库的 docs/WINDOWS.md）。",
			"row.selectionLostHint": "已保存的账号在本机已不存在。",
			"row.selectionLostMessage": "该区域保存的账号已不在本机登录列表中（WorkBuddy 更换了登录或清理了备份文件）。本机其他登录仍然可用——请在上方列表中重新选择一个当前账号。重新登录桌面端 App 无法修复此问题。",
			"row.modelsTitle": "模型",
			"row.modelsSummary": "已启用 {count} 个",
			"row.modelsDirty": "有未保存的修改",
			"row.modelsRefresh": "从 WorkBuddy 刷新",
			"row.modelsRefreshing": "正在刷新模型…",
			"row.discard": "放弃修改",
			"row.save": "保存",
			"row.saving": "保存中…",
			"row.saveError": "保存失败：{message}",
			"row.saveContentionHint": "（该文件被占用，写入被拒——Windows 上通常是杀毒软件、OneDrive 这类同步盘，或正打开该文件的编辑器。请先关闭占用者再保存一次；你的改动仍然还在。）",
			"row.modelContext": "最大上下文 {context}",
			"row.contextBudget": "DSH 上下文预算",
			"row.modelOutput": "最大输出 {output}",
			"row.modelRate": "积分 {rate}x",
			"row.modelMultimodal": "多模态",
			"row.modelImage": "图片",
			"row.modelImageText": "图片输入：厂商文档标明该模型仅支持文本，因此刷新时不会自动勾选。只有你确认它能读图，才建议手动勾上。",
			"row.modelImageUnverified": "图片输入未核实：没有厂商资料确认该模型能读图，刷新时按「不猜」处理，不会自动勾选。如果你验证过确实可用，可以手动勾上。",
			"row.modelOff": "可关闭思考",
			"row.modelOffHint": "为这个模型提供「关闭思考」档位",
			"row.modelReasoning": "推理强度：{efforts}",
			"row.modelUnknown": "未知",
			"row.modelCapabilityPending": "仅展示 WorkBuddy 接口明确公布的模型能力。",
			"row.probe": "测试",
			"row.probing": "测试中…",
			"row.probeHint": "对该模型发一条真实体积的请求（约 25k 输入 token），报告它现在能不能用。上游的限流按请求体积触发——实测约 20k 能过、约 30k 被拒——所以小请求看着正常、长对话里却可能每次都被拒。这也是为什么每次测试都会消耗真实积分（约 0.7），且一次只测一个模型。",
			"row.probeOk": "✓ 可用",
			"row.probeOkMs": "✓ 可用（{ms}）",
			"row.probeRateLimitedUnknown": "✗ 被限流 · 上游未给出何时恢复",
			"row.probeRateLimitedAt": "✗ 被限流 · {at} 之后可再用",
			"row.probeOutOfCreditUnknown": "✗ 积分不足 · 上游未给出何时恢复",
			"row.probeOutOfCreditAt": "✗ 积分不足 · 积分包 {at} 刷新",
			"row.probeCredentialRejected": "✗ WorkBuddy 拒绝了这个账号的 token——请重新登录或换一个账号",
			"row.probePolicyRejected": "✗ WorkBuddy 服务端按内容策略拒绝了这次请求——重新登录无效；可在桌面端验证或切换区域/账号",
			"row.probeNotFound": "✗ 上游不认识这个模型",
			"row.probeUnavailable": "✗ 连不上上游——上游没有给出可用答复",
			"row.probeFailed": "✗ 测试失败",
			"row.probeFailedStatus": "✗ 测试失败（HTTP {status}）",
			"row.probeError": "无法执行测试：{message}",
			"row.cheer": "鼓励一下",
			"row.poolTitle": "账号池",
			"row.poolNoCandidate": "账号池里目前没有可用的账号。",
			"row.poolNoCandidateHint": "成员要么在限流冷却中、要么积分耗尽、要么凭据被拒、要么上游无响应。限流、积分耗尽与瞬时故障都会自动回池——按上游给出的恢复时间，没给时间就按 30 分钟兜底，不需要你操作；只有「凭据被拒」需要重新登录。",
			"row.poolCheckinAll": "一键签到所有账号",
			"row.poolCheckingIn": "签到中…",
			"row.poolTestAll": "一键测试所有账号",
			"row.poolTesting": "测试中…",
			"row.poolBusyHint": "正在逐个账号执行…",
			"row.poolTargetAuto": "自动",
			"row.poolTargetStaleShort": "目标模型已失效",
			"row.poolTargetNoneShort": "无免费模型",
			"row.poolTargetFree": "自动选中的免费模型：{model}",
			"row.poolTargetPreferred": "你指定的模型：{model}",
			"row.poolTargetCurrentPreferred": "当前：{model}（你指定）。",
			"row.poolTargetCurrentFree": "当前：{model}（自动挑选的免费模型）。",
			"row.poolTargetNone": "本区域暂时没有倍率为 0 的免费模型。",
			"row.poolTargetStale": "你保存的目标模型已不在目录中：{model}",
			"row.poolTargetStaleHint": "本区域的模型目录已变化，不再包含这个模型，因此测试被停用——而不是拿一个上游可能不接受的模型去跑。请改选一个目标模型，或切回自动。",
			"row.poolTargetStaleClear": "切回自动",
			"row.poolTargetStaleOption": "{model}（已下架）",
			"row.poolTargetNoneHint": "国内版的倍率要等模型目录刷新后才会出现。为了不让你在不知情的情况下花掉积分，插件不会自动改用收费模型——请先刷新模型目录，或自己指定一个目标模型。",
			"row.poolColumnAccount": "账号",
			"row.poolColumnCredits": "积分",
			"row.poolColumnProbe": "目标模型",
			"row.poolColumnCheckin": "签到",
			"row.poolNeverTested": "尚未测试",
			"row.poolTestedAt": "测试于 {at}",
			"row.poolCheckedIn": "已签到",
			"row.poolNotCheckedIn": "未签到",
			"row.poolCheckinUnknown": "—",
			"row.poolCreditSoon": "{count} 积分 3 天内过期",
			"row.poolCreditNearest": "最近积分包 {at} 过期",
			"row.poolExcludedRateLimited": "被限流",
			"row.poolExcludedOutOfCredit": "积分耗尽",
			"row.poolExcludedRejected": "被拒绝",
			"row.poolExcludedUnusable": "不可用",
			"row.poolRetryAt": "{at} 之后可再用",
			"row.poolRetryUnknown": "上游未给出何时恢复",
			"row.remainingImminent": "即将恢复",
			"row.remainingMinutes": "约 {count} 分钟后",
			"row.remainingHours": "约 {count} 小时后",
			"row.remainingDays": "约 {count} 天后",
			"row.poolProbeJustNow": "刚刚",
			"row.poolProbeMinutesAgo": "{count} 分钟前",
			"row.poolProbeHoursAgo": "{count} 小时前",
			"row.poolProbeDaysAgo": "{count} 天前",
			"row.poolProbeSourceTest": "测得",
			"row.poolProbeSourceLive": "聊天撞上",
			"row.poolProbeSourceUnknown": "来源未知",
			"row.poolSettingsTitle": "账号池设置",
			"row.poolSettingsHint": "下面是偏好设置：点保存才生效（与「模型管理」一致）。测试结果由插件自动写入，不受这个保存按钮影响。",
			"row.poolEnabled": "启用账号池",
			"row.poolEnabledHint": "开启后由本区域的账号池自动决定每一次请求用谁（可用优先，其次积分高、快过期的积分包、凭据更新的），失败时自动换下一个可用账号。关闭后插件不替你选、也不替你换：你选的账号服务每一次请求，失败就如实报错。签到与测试是手动动作，两种状态下都可用 —— 这个开关只管「插件要不要自己决定」。",
			"row.poolManualAccountLabel": "使用哪个账号",
			"row.poolManualAccountHint": "账号池关闭时，由你在这里选定服务本区域的账号。开启账号池后改由排序自动决定。",
			"row.poolManualAccountNone": "当前没有生效的账号",
			"row.poolTargetLabel": "目标测试模型",
			"row.poolTargetHint": "「自动」（默认）会从本区域目录里挑一个倍率为 0 的免费模型，多个候选取上下文窗口最大的。国内版与国际版可能挑到不同的模型。手动指定优先于自动。",
			"row.poolTargetAutoOption": "自动 —— 挑一个免费模型",
			"row.poolProbeSizeLabel": "测试请求体积",
			"row.poolProbeSizeHint": "测试时发送多少文本。上游在请求大约超过 2 万～3 万 token 时会开始拒绝，所以测试体积若小于你真实对话的体积，就会出现「测出可用、实际一发就被限」。体积越大测得越准，但每次测试消耗的积分也越多。",
			"row.poolProbeSizeDefault": "默认（2.5 万）",
			"row.poolProbeSizeOption": "{tokens} 万 token",
			"row.poolSaved": "保存",
			"row.poolSaving": "保存中…",
			"row.poolSaveFailed": "保存失败：{message}",
			"row.poolSavedStaleRefresh": "已保存，但面板未能重新读取。设置已写入；下次刷新后会显示。",
			"row.poolDiscard": "放弃修改",
			"row.poolDirty": "● 有未保存的修改",
			"row.poolManualUnlock": "关闭自动轮换",
			"row.poolLogTitle": "活动记录",
			"row.poolLogClear": "清空",
			"row.poolLogEmpty": "尚无活动。签到、测试与账号切换都会记录在这里。",
			"row.poolLogCheckinStart": "开始签到 {count} 个账号（逐个执行）",
			"row.poolLogCheckinClaimed": "{accountName}：签到成功 +{credit}",
			"row.poolLogCheckinAlready": "{accountName}：今日已签到，跳过",
			"row.poolLogCheckinFailed": "{accountName}：签到失败 —— {message}",
			"row.poolLogCheckinDone": "签到完成",
			"row.poolLogBatchFailed": "批量操作失败 —— 没有执行：{message}",
			"row.poolLogTestStart": "开始测试 {count} 个账号 × {model}",
			"row.poolLogTestRow": "{accountName}：{outcome}",
			"row.poolLogTestDone": "测试完成，已重新计算候选账号",
			"row.poolLogTestRowMalformed": "{accountName}：Host 未返回该账号的结果",
			"row.poolRegionNote": "国内版与国际版是完全独立的两个账号池：账号、开关、间隔、目标模型互不影响。",
			"row.poolMembersTitle": "本池包含的账号",
			"row.poolMembersHint": "只有勾选的账号才会被签到、测试和轮换。默认一个都不勾 —— 请勾选你要的账号，然后保存。",
			"row.poolSelectAll": "全选",
			"row.poolSelectNone": "全不选",
			"row.poolSelectedCount": "已选 {count} / {total}",
			"row.poolNoneSelected": "这个池里还没有勾选任何账号。",
			"row.poolNoneSelectedHint": "请在上方勾选至少一个账号并保存。在此之前两个按钮都不可用 —— 空池没有可执行的对象。",
			"row.poolGhostMembers": "有 {count} 个已保存的账号在本机已不再登录，因此不计入、也不会被使用。再保存一次即可移除它们。",
			"row.poolSelectAria": "把 {accountName} 加入本区域的账号池",
			"row.poolMember": "已在池中",
			"row.poolCurrentBadge": "当前使用",
			"row.poolCurrentHeader": "当前使用：{account}",
			"row.poolNotMember": "未入池",
			"row.poolUnsavedMembers": "勾选已改动 —— 保存后生效"
		};
		//#endregion
		//#region src/client/index.tsx
		/**
		* Browser half: WorkBuddy credits and model management inside Plugin
		* configuration.
		*
		* 参考：dingminhua/dsh-connect-trae（MIT，Copyright (c) 2026 LaoDing）
		*   — 浏览器插件的注册形态（`slots` / `locale` / `settingsScope` 三项注入、
		*     `LocaleNamespaceMap` 的模块增强、`settings.plugin.item` 槽位与
		*     `key` / `priority` 的 rc.7 写法、以及整个 apply 体包 try/catch
		*     以便槽位 API 变更时降级为 console.error 而不触发
		*     "Failed to load plugins" 红色横幅）来自该项目，
		*     其亦注明沿用 corrinehu/dsh-workbuddy-connect 的同一模式。
		* 改动：无实质改动，仅改为本插件的命名空间与组件名。
		*
		* NOTE: the try/catch boundary of this function is mirrored (duplicated) in
		* `tests/client-fallback.spec.ts`, because the real client entry imports
		* browser-only DSH packages that cannot load in the Node test environment.
		* That test therefore does not import this function — it replicates its
		* shape. If you change the guarded body or the `console.error` message here,
		* update the mirrored `apply()` in that spec too, or the fallback test will
		* silently diverge from this real implementation.
		*
		* @module dsh-connect-workbuddy/client
		*/
		/** Stable browser-plugin name. */
		const name = "dsh-connect-workbuddy-client";
		/**
		* Client services required by the Plugin configuration contribution.
		*
		* Deliberately only the two services that exist on BOTH host lines. The
		* settings surface differs by line — 0.1.5 provides `settingsScope`, 0.1.7
		* replaces it with `configForms` — and Cordis' dependency gate is hard: any
		* inject entry the running line does not provide keeps `apply` from ever
		* running. Probing both via `ctx.get()` (which returns undefined, never
		* throws, for an absent service) is what lets one build serve both lines.
		*/
		const inject = ["slots", "locale"];
		/** Register card copy and the WorkBuddy card under Plugin configuration. */
		function apply(ctx) {
			try {
				const namespace = "settings.workbuddy";
				ctx.effect(() => ctx.locale.register(namespace, {
					zh,
					en
				}), "dsh-connect-workbuddy: settings copy");
				const t = ctx.locale.bind(namespace);
				const softGet = (name) => ctx.get(name);
				let settingsScope;
				const forms = softGet("configForms");
				if (forms !== void 0) {
					let ns = WORKBUDDY_SETTINGS_NS;
					try {
						const served = (forms.describe().getSnapshot().view?.namespaces ?? []).find((entry) => entry.ns === "workbuddy" || /workbuddy/i.test(entry.ns));
						if (served !== void 0) ns = served.ns;
					} catch {}
					settingsScope = forms.get(ns);
				}
				const registerCard = (slotName, key) => {
					try {
						ctx.slots.inject(slotName, () => ctx.slots.register({
							name: slotName,
							key,
							priority: 30,
							inject: () => settingsScope === void 0 ? { t } : {
								t,
								settingsScope
							}
						}, WorkBuddyCard));
					} catch (error) {
						console.error(`[dsh-connect-workbuddy] card slot "${slotName}" failed to register (host provider unaffected):`, error);
					}
				};
				registerCard("plugins.bundle.config", "dsh-connect-workbuddy");
				registerCard("plugins.row.config", "dsh-connect-workbuddy#dsh-connect-workbuddy");
			} catch (error) {
				console.error("[dsh-connect-workbuddy] client card failed to load (host provider unaffected):", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
