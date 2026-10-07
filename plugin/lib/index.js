import { $ as macosNestedAppBundles, A as workbuddyOwnAuthPath, B as parseUpstreamModel, C as defaultDesktopAuthDirs, D as legacyWorkbuddyOwnAuthPath, E as isEncryptedCredentialError, F as classifyUpstreamError, G as deriveAtRestKey, H as regionOf, I as declaredTools, J as findWorkbuddyAppExecutable, K as deriveAtRestKeyId, L as isCredentialRejectedError, M as WORKBUDDY_FALLBACK_SYSTEM_PROMPT, N as WorkBuddyCredentialRejectedError, O as parseWorkBuddyAuth, P as WorkBuddyUpstreamClient, Q as macosBundleExecutable, R as parseCreditMultiplier, S as defaultDesktopAuthCandidates, T as hasEncryptedCredentialFields, U as WORKBUDDY_APP_EXECUTABLE_ENV, V as prepareChatBody, W as clearAtRestKeyCache, X as isEncryptedFieldWrapper, Z as isWorkbuddyBundle, _ as WORKBUDDY_AUTH_FILENAME, a as readHostHeartbeat, b as WorkBuddyEncryptedCredentialError, c as WORKBUDDY_CONNECT_VERSION, d as FALLBACK_WORKBUDDY_MODELS_GLOBAL, et as openEncryptedField, f as WorkBuddyCatalog, g as ENCRYPTED_CREDENTIAL_CODE, h as fallbackModelsFor, i as processStartTimeMs, j as CREDENTIAL_REJECTED_CODE, k as workbuddyAccountId, l as piAiRuntimeInfo, m as deriveCatalog, n as clearHostHeartbeat, nt as workbuddyAppExecutableCandidates, o as workbuddyHostHeartbeatPath, p as applyContextBudgets, q as fetchAtRestKeyPayload, r as isHeartbeatProcessAlive, s as writeHostHeartbeat, t as WORKBUDDY_HOST_HEARTBEAT_FILENAME, tt as readAtRestKey, u as FALLBACK_WORKBUDDY_MODELS, v as WORKBUDDY_AUTH_FILE_ENV, w as defaultDesktopAuthPath, x as authFileName, y as WorkBuddyCredentialStore, z as parseReasoning } from "./host-heartbeat-Cg2ahl1n.js";
import z from "@deepseek-ai/schemastery";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { createServer } from "node:http";
import { Readable } from "node:stream";

/**
 * 用 workbuddy共享工具产出的 WorkBuddy Key 直连上游，替代官方的登录态读取。
 * 只需实现 apply / shim 实际调用到的 store 方法；其余照官方插件原样运行。
 */
function readOurKey() {
  const env = process.env.WORKBUDDY_API_KEY;
  if (typeof env === "string" && env.length > 0) return env.trim();
  const candidates = [
    join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".wbbuddy", "key"),
    join(process.env.APPDATA ?? "", "dsh-desktop", "harness", ".workbuddy_key")
  ];
  for (const p of candidates) {
    try {
      const s = readFileSync(p, "utf8").trim();
      if (s.length > 0) return s;
    } catch {}
  }
  return void 0;
}

function createWorkBuddyKeyStore(regionKey) {
  // 每个区域用对应的上游域名；client 的 chatBase/regionOf 据此决定走国内还是国际网关。
  const domain = regionKey === "global" ? "workbuddy.ai" : "copilot.tencent.com";
  const resolve = () => {
    const key = readOurKey();
    if (key === void 0 || key.length === 0) throw new Error("WorkBuddy Key 未找到：请先用 workbuddy共享工具生成并写入 .wbbuddy/key");
    // 官方 client.chatStream 用 credential.accessToken 当 Bearer，chatBase 用 credential.domain
    // 决定网关；两者都必须有值，否则 domain 为 undefined 会触发 .trim() 报错。
    return {
      key,
      accessToken: key,
      refreshToken: "",
      domain,
      uid: "",
      enterpriseId: "",
      nickname: "WorkBuddy Key",
      source: "wbbuddy",
      accountId: "workbuddy-key",
      id: "workbuddy-key",
      expiresAtMs: Number.MAX_SAFE_INTEGER,
      lastRefreshAtMs: 0
    };
  };
  return {
    resolve,
    accounts: async () => [{ id: "workbuddy-key", accountName: "WorkBuddy Key" }],
    credentialFor: async () => resolve(),
    current: async () => resolve(),
    selectAccount: () => {},
    setDesktopPath: () => {},
    modify: async () => {},
    read: async () => {},
    list: async () => [],
    delete: async () => {},
    refreshToken: (c) => c
  };
}

//#region src/credential-recovery.ts
/** How long a verdict stays fresh by default. */
const DEFAULT_PROBE_TTL_MS = 6e4;
/**
* Cached "is this account still accepted upstream?" probe.
*
* The cache key includes the credential's own `lastRefreshAtMs`, so a fresh
* sign-in (which rewrites the file's issuance time) invalidates a stale verdict
* automatically — a rejection recorded before the user signed in again cannot
* keep labelling the account unusable afterwards, and no explicit invalidation
* is needed.
*/
function createAccountUsabilityProbe(options) {
	const ttlMs = options.ttlMs ?? DEFAULT_PROBE_TTL_MS;
	const now = options.now ?? Date.now;
	const verdicts = /* @__PURE__ */ new Map();
	return async (region, account) => {
		let credential;
		try {
			credential = await options.store(region).credentialFor(account.id);
		} catch {
			return false;
		}
		if (credential === void 0) return false;
		const key = `${region}\0${account.id}\0${credential.lastRefreshAtMs ?? credential.expiresAtMs}`;
		const cached = verdicts.get(key);
		if (cached !== void 0 && now() - cached.at < ttlMs) return cached.usable;
		let usable = false;
		try {
			await options.client.fetchCheckinStatus(credential);
			usable = true;
		} catch {
			usable = false;
		}
		verdicts.set(key, {
			at: now(),
			usable
		});
		return usable;
	};
}
/**
* Decide what to tell the user after the upstream refused the selected
* credential: switch to a verified-usable account, or sign in again.
*
* The two answers are mutually exclusive by construction. `reloginRequired` is
* set ONLY when there is no other local account to switch to — never as a
* fallback for "the probe did not verify anything", because that would repeat
* the misdirection this module exists to remove. When other accounts exist but
* none was verified, both fields stay empty and the card says so honestly.
*/
async function resolveCredentialRecovery(options) {
	let accounts;
	try {
		accounts = await options.store.accounts();
	} catch {
		return { reloginRequired: false };
	}
	const others = accounts.filter((account) => account.id !== options.rejectedAccountId);
	if (others.length === 0) return { reloginRequired: true };
	for (const account of others) if (await options.probe(options.region, account)) return {
		usableAccount: {
			accountId: account.id,
			accountName: account.accountName
		},
		reloginRequired: false
	};
	return { reloginRequired: false };
}
//#endregion
//#region src/adapter.ts
/**
* The WorkBuddy pi-ai providers: loopback-backed adapters registered
* into the Harness LLM seam, assembled from public `dsh-llm-pi-ai`
* extension points. One instance per region — `workbuddy` for the domestic
* gateway, `workbuddy-global` for the international one — each pointing at
* its own shim and catalog so the two regions serve simultaneously.
*
* 参考：corrinehu/dsh-workbuddy-connect（MIT，Copyright (c) 2026 Corrine Hu）
*   — pi-ai provider 的装配方式（createProvider + openAICompletionsApi +
*     inert auth plane + 用 shim 的进程内 secret 作为 apiKey）由该项目实现；
*   DSH 插件结构与 provider 注册的思路参照
*     franksong2702/dsh-codex-connect（Apache-2.0），经其转引。
* 改动：模型描述符补上 upstream 给出的多模态与推理档位信息（若有），
*   供 DSH 的能力判断使用；工厂参数化 provider id，支持双区域实例。
*
* @module dsh-connect-workbuddy/adapter
*/
/** Provider route this bundle owns for the domestic (CN) gateway. */
const WORKBUDDY_PROVIDER = "workbuddy-llm";
/** Provider route this bundle owns for the international gateway. */
const WORKBUDDY_GLOBAL_PROVIDER = "workbuddy-llm-global";
/** The provider id each region registers as. */
const WORKBUDDY_PROVIDERS = {
	cn: WORKBUDDY_PROVIDER,
	global: WORKBUDDY_GLOBAL_PROVIDER
};
/** Region a provider route id belongs to. */
function regionOfProvider(provider) {
	for (const [region, id] of Object.entries(WORKBUDDY_PROVIDERS)) if (id === provider) return region;
}
/** Human-readable provider name, shown in the DSH model picker. */
const WORKBUDDY_PROVIDER_DISPLAY_NAMES = {
	cn: "WorkBuddy",
	global: "WorkBuddy Global"
};
/** Provider idle ceiling while one stream read is outstanding. */
const WORKBUDDY_STREAM_IDLE_TIMEOUT_MS = 3e5;
/**
* Image-request budgets at the dsh-llm-pi-ai defaults; the profile type made
* them required in 0.1.1-rc.2.
*/
const REQUEST_IMAGE_BUDGETS = {
	maxRequestImageBytes: 20971520,
	requestImagePixelBudget: 4194304,
	requestImageMaxBytes: 1048576
};
/**
* Inert pi-ai auth plane. The workbuddy route authenticates only through the
* shim shared secret resolved per request by `resolveApiKey`, so pi-ai's own
* credential lifecycle and ambient discovery must never manufacture a
* credential for it. `PiAiAdapterOptions.auth` is required since 0.1.1-rc.2;
* every ambient question here answers "nothing stored, nothing set".
*/
const INERT_AUTH = {
	credentials: {
		async read() {},
		async list() {
			return [];
		},
		async modify() {
			throw new Error("dsh-connect-workbuddy: the workbuddy route has no pi-ai credential lifecycle");
		},
		async delete() {}
	},
	authContext: {
		async env() {},
		async fileExists() {
			return false;
		}
	}
};
/** No per-token pricing is knowable for a subscription quota; report zero. */
const NO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0
};
const THINKING_LEVELS = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/** pi-ai input modalities: images only when WorkBuddy advertises them. */
function workBuddyModelInput(info) {
	return info.multimodal === true ? ["text", "image"] : ["text"];
}
/**
* DSH-facing display name: the model name plus the upstream credit multiplier,
* spelled the way WorkBuddy's own selector does (`GLM-5.3 · x0.79`).
*
* Display-only by construction: every DSH-side join keys on the model id —
* the selector's current choice (`provider` + `model`), the durable
* `model/selection` / `request/header` session events, the agent default-model
* settings, and the request wire (`model: <id>` reaching the shim). A model
* without a parsed multiplier keeps its bare name; a zero multiplier shows
* `x0.00`, matching WorkBuddy's rendering of free models.
*/
function workBuddyDisplayName(info) {
	return info.creditMultiplier === void 0 ? info.name : `${info.name} · x${info.creditMultiplier.toFixed(2)}`;
}
/** Map only levels advertised by WorkBuddy; undeclared DSH levels stay unavailable. */
function workBuddyThinkingLevelMap(info) {
	const supported = info.reasoning?.supportedEfforts?.filter((effort) => THINKING_LEVELS.includes(effort));
	if (supported === void 0 || supported.length === 0) return void 0;
	const map = Object.fromEntries(THINKING_LEVELS.map((level) => [level, supported.includes(level) ? level : null]));
	if (info.reasoning?.canDisableThinking !== true) map.off = null;
	return map;
}
/** Build one pi-ai model descriptor pointing at the loopback shim. */
function toPiModel(info, baseUrl, providerId) {
	const thinkingLevelMap = workBuddyThinkingLevelMap(info);
	return {
		id: info.id,
		name: workBuddyDisplayName(info),
		api: "openai-completions",
		provider: providerId,
		baseUrl,
		input: workBuddyModelInput(info),
		cost: NO_COST,
		contextWindow: info.contextWindow,
		maxTokens: info.maxTokens,
		reasoning: thinkingLevelMap !== void 0,
		...thinkingLevelMap === void 0 ? {} : { thinkingLevelMap },
		compat: { supportsReasoningEffort: thinkingLevelMap !== void 0 }
	};
}
/**
* Rewrite a pi-ai 0.87-shaped transcript into the 0.85 shape this plugin's
* pi-ai understands — prompt AND tools.
*
* WHY THIS EXISTS (issue #24). pi-ai 0.87's `normalizeContext` moves the system
* prompt INTO `messages` as `{ role: 'system', content: '<string>' }`. pi-ai
* 0.85's own `Message` union has no `system` variant
* (`UserMessage | AssistantMessage | ToolResultMessage`), so its
* `estimateMessageTokens` has no branch for one: `for (const block of
* message.content)` iterates the CONTENT STRING character by character, `block`
* is a single character, and `block.name.length` throws
* `Cannot read properties of undefined (reading 'length')`.
*
* That crash happens inside the library, in `buildBaseOptions ->
* clampMaxTokensToContext -> estimateContextTokens`, i.e. BEFORE any request is
* built — so every model fails instantly and no upstream traffic is sent. A
* host running 0.87 hands us the normalized transcript while our own provider
* is 0.85, and the plugin cannot patch the library. What it CAN do is not hand
* a 0.87 transcript to a 0.85 API object.
*
* The 0.87 transcript carries MORE than the prompt on that leading system
* message: `toolsAdded` (and `toolsRemoved`) are the ONLY place the tool
* declarations live — `normalizeContext` deleted the top-level `tools` field,
* and 0.85's api reads tools ONLY from `context.tools`. So folding the text
* without promoting the tool state would trade issue #24's loud crash for
* issue #26's silent one: models that can never emit a `toolCall` because the
* request never declared any tools. The fold here promotes both, replaying
* every system message's `toolsRemoved`/`toolsAdded` in order — exactly the
* merge pi-ai 0.87's own `getCurrentTools` performs — and leaves an existing
* top-level `tools` array untouched.
*
* Deliberately SHAPE-based within the legacy branch, not version-based: it
* asks "does this context carry a system message inside `messages`?" rather
* than "which pi-ai version is loaded?". A version check would be wrong the
* moment either side moves. Which BRANCH runs at all IS generation-gated —
* see {@link withLegacyContext}: a modern (0.87+) api consumes this very
* transcript natively, and folding for it would destroy its only carrier of
* prompt and tools (issues #25/#26).
*
* Returns the SAME object when there is nothing to adapt — in particular when
* `systemPrompt` is already set (the native 0.85 shape), so the ordinary path
* is byte-for-byte untouched.
*
* Two guards beyond the 0.87 fold, both about a request reaching the upstream
* with NO system message — which the international gateway refuses outright
* (business code 11128) while the domestic one tolerates:
*
* - an EMPTY `systemPrompt` is treated as absent rather than "already set".
*   pi-ai emits the prompt under `if (context.systemPrompt)`, so an empty one
*   produces no system message at all and pi-ai demotes any `system` entry still
*   in `messages` to `user`. Falling through here lets a real system message
*   that IS present in `messages` be folded up and preserved.
* - when nothing supplies a prompt, {@link WORKBUDDY_FALLBACK_SYSTEM_PROMPT} is
*   used, because a placeholder beats a guaranteed 400. A system message whose
*   text is empty but which carries `toolsAdded` still folds its TOOLS up; the
*   placeholder for the missing prompt then comes from `ensureSystemHead` at
*   the wire (the last of the three layers).
*/
function adaptLegacyPiAiContext(context) {
	if (context === null || typeof context !== "object") return context;
	if (context.systemPrompt) return context;
	const messages = Array.isArray(context.messages) ? context.messages : void 0;
	if (messages === void 0) return context;
	const systemTexts = [];
	const rest = [];
	const toolState = /* @__PURE__ */ new Map();
	let sawSystemMessage = false;
	for (const message of messages) {
		if (message?.role !== "system") {
			rest.push(message);
			continue;
		}
		sawSystemMessage = true;
		const text = systemTextOf(message);
		if (text !== "") systemTexts.push(text);
		replayToolState(message, toolState);
	}
	const head = rest[0];
	const needsFallback = !sawSystemMessage && head !== void 0 && head.role !== "system";
	if (!sawSystemMessage && !needsFallback) return context;
	const systemPrompt = systemTexts.length > 0 ? systemTexts.join("\n\n") : sawSystemMessage ? void 0 : WORKBUDDY_FALLBACK_SYSTEM_PROMPT;
	const tools = Array.isArray(context.tools) ? void 0 : [...toolState.values()];
	return {
		...context,
		...systemPrompt === void 0 ? {} : { systemPrompt },
		...tools !== void 0 && tools.length > 0 ? { tools } : {},
		messages: rest
	};
}
/**
* Replay one 0.87 system message's tool deltas into `state`, the same merge
* pi-ai 0.87's `getCurrentTools` performs: removals first, then additions,
* keyed by name so a mid-conversation redeclaration replaces the original.
*/
function replayToolState(message, state) {
	const removed = message.toolsRemoved;
	if (Array.isArray(removed)) for (const tool of removed) {
		const name = tool?.name;
		if (typeof name === "string") state.delete(name);
	}
	const added = message.toolsAdded;
	if (Array.isArray(added)) for (const tool of added) {
		const name = tool?.name;
		if (typeof name === "string") state.set(name, tool);
	}
}
/** The text of one system message, whether it is a string or text blocks. */
function systemTextOf(message) {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const texts = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const candidate = block;
		if (candidate.type === "text" && typeof candidate.text === "string") texts.push(candidate.text);
	}
	return texts.join("\n\n");
}
/**
* Wrap one pi-ai API module so both stream entry points receive a context this
* build can actually consume (see {@link adaptLegacyPiAiContext}) — but only
* when the module RESOLVED for this plugin is the legacy generation.
*
* The gate is the plugin's own module, resolved via {@link piAiRuntimeInfo}
* (manifest version of the copy this plugin resolves — no pi-ai import): a
* modern (0.87+) api consumes the normalized
* transcript natively — its request builder reads the prompt from the leading
* system message and the tools from that message's `toolsAdded`, and never
* reads the top-level `systemPrompt`/`tools` fields at all. Folding for it
* would delete the only carrier of both (issues #25/#26: the international
* gateway answers the prompt-less body with 400 / 11128, the domestic one
* accepts it and the model fabricates tool calls it can never actually make).
* The unwrapped modern api is returned AS-IS — byte-for-byte pass-through.
*
* The deferred-fetch entry points take no context and are passed through as-is
* in both branches.
*/
function withLegacyContext(api, generation) {
	if (generation === "modern") return api;
	return {
		...api,
		stream: (model, context, options) => api.stream(model, adaptLegacyPiAiContext(context), options),
		streamSimple: (model, context, options) => api.streamSimple(model, adaptLegacyPiAiContext(context), options)
	};
}
/**
* Assemble the adapter. The provider's `getModels` reads the live catalog,
* and every model's `baseUrl` is re-resolved per read so the shim's
* ephemeral port applies from the first snapshot after startup.
*/
function createWorkBuddyAdapter(options) {
	const { shim, store, catalog, resolveAttachments } = options;
	const providerId = options.provider ?? "workbuddy";
	const providerName = options.displayName ?? "WorkBuddy";
	const generation = options.piAiGeneration ?? piAiRuntimeInfo().generation;
	const buildModels = () => {
		const baseUrl = `${shim.baseUrl()}/v1`;
		return catalog.current().map((info) => toPiModel(info, baseUrl, providerId));
	};
	const provider = {
		...createProvider({
			id: providerId,
			name: providerName,
			auth: { apiKey: {
				name: "WorkBuddy OAuth bearer token",
				async resolve({ credential }) {
					const apiKey = credential?.key;
					return apiKey === void 0 || apiKey.length === 0 ? void 0 : {
						auth: { apiKey },
						source: "WorkBuddy"
					};
				}
			} },
			models: buildModels(),
			api: withLegacyContext(openAICompletionsApi(), generation)
		}),
		getModels: () => buildModels()
	};
	const profile = {
		provider: providerId,
		displayName: providerName,
		streamIdleTimeoutMs: WORKBUDDY_STREAM_IDLE_TIMEOUT_MS,
		retryPolicy: resolveRetryPolicy(void 0, "dsh-connect-workbuddy retryPolicy"),
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		modelErrors: /* @__PURE__ */ new Map(),
		...REQUEST_IMAGE_BUDGETS,
		piProvider: provider
	};
	let profiles = /* @__PURE__ */ new Map([[providerId, profile]]);
	return {
		adapter: new PiAiAdapter({
			profiles: () => profiles,
			auth: INERT_AUTH,
			resolveApiKey: async () => shim.token(),
			...resolveAttachments === void 0 ? {} : { resolveAttachments }
		}),
		invalidate: () => {
			profiles = /* @__PURE__ */ new Map([[providerId, profile]]);
		}
	};
}
/** One or two full-width bars — the count is a spelling variable. */
const BARS = `｜｜?`;
new RegExp(`${BARS}DSML${BARS}`, "g");
/**
* Spellings a tag may carry before its name, longest first so the doubled form
* is consumed before the single one can match its prefix.
*
* The ASCII spellings are accepted because the model mixes them: the marker is
* normalised to ASCII by {@link normalizedPrefixLength}, which is also the only
* way to catch a block that spells the two sides differently.
*/
const MARKUP_PREFIXES = [
	`｜｜DSML｜｜`,
	"||DSML||",
	"|DSML|"
];
/** What the full-width marker looks like after {@link normalizedPrefixLength}. */
const ASCII_PREFIXES = ["||DSML||", "|DSML|"];
/**
* Tag names that can OPEN a block worth recovering.
*
* Deliberately tiny. `parameter` and the model's ad-hoc tag names are NOT here:
* they only ever appear inside a block, so treating one as a block start would
* hold a response hostage waiting for a close that naming never promised.
*/
const BLOCK_TAGS = ["tool_calls", "invoke"];
/**
* Tag names whose content belongs to the markup rather than to the answer.
*
* Used by {@link stripMarkup} to decide whether removing a marker-bearing tag
* should also remove everything up to its matching close. An INVENTED name is
* not here on purpose: `<｜DSML｜ validate>` brackets nothing, so removing it
* means removing the tag and nothing else.
*/
const KEYWORD_TAGS = [
	"tool_calls",
	"tool-calls",
	"toolcalls",
	"invoke",
	"parameter",
	"calls",
	"tool"
];
/** Tag names normalised to their canonical spelling. */
const CANONICAL_TAG_NAMES = /* @__PURE__ */ new Map([
	["tool_calls", "tool_calls"],
	["tool-calls", "tool_calls"],
	["toolcalls", "tool_calls"],
	["invoke", "invoke"],
	["parameter", "parameter"]
]);
/**
* Canonical names accepted ONLY in a marker form.
*
* `<toolcalls>` without the marker is somebody's HTML, not the model's markup;
* the marker is what makes the misspelling meaningful.
*/
const MARKER_ONLY_TAG_NAMES = /* @__PURE__ */ new Set(["tool-calls", "toolcalls"]);
/** Fence markers at the start of a line. */
const FENCE_MARKERS = ["```", "~~~"];
/**
* Find every span that must not be scanned for markup.
*
* One pass, not a predicate call per character: the reference asks
* `is_inside_markdown_fence(text, i)` inside a per-character loop, which is
* quadratic in the size of the buffer. The buffer holds a whole block, and a
* block can be large (a file's worth of arguments), so the port computes the
* spans once and walks them.
*
* Semantics match the reference: fences only count at the start of a line,
* code spans are runs of one or two backticks, and an unterminated span runs to
* the end of the text (the closer may still be in flight).
*/
function ignoredSpans(text) {
	const spans = [];
	let i = 0;
	let fence;
	let fenceStart = 0;
	while (i < text.length) {
		const atLineStart = i === 0 || text.charAt(i - 1) === "\n";
		if (fence !== void 0) {
			if (atLineStart && text.startsWith(fence, i)) {
				const lineEnd = text.indexOf("\n", i);
				const end = lineEnd === -1 ? text.length : lineEnd + 1;
				spans.push({
					start: fenceStart,
					end,
					open: false
				});
				fence = void 0;
				i = end;
				continue;
			}
			i += 1;
			continue;
		}
		if (atLineStart) {
			const marker = FENCE_MARKERS.find((candidate) => text.startsWith(candidate, i));
			if (marker !== void 0) {
				fence = marker;
				fenceStart = i;
				i += marker.length;
				continue;
			}
		}
		if (text.charAt(i) === "`") {
			const end = codeSpanEnd(text, i);
			if (end === -1) {
				spans.push({
					start: i,
					end: text.length,
					open: true
				});
				break;
			}
			spans.push({
				start: i,
				end,
				open: false
			});
			i = end;
			continue;
		}
		const xml = xmlIgnoredEnd(text, i);
		if (xml !== void 0) {
			spans.push(xml);
			if (xml.end >= text.length && xml.open) break;
			i = xml.end;
			continue;
		}
		i += 1;
	}
	if (fence !== void 0) spans.push({
		start: fenceStart,
		end: text.length,
		open: true
	});
	return spans;
}
/**
* End of the inline code span starting at `start`, or -1 when there is none.
*
* Three or more backticks are a fence, not a code span — {@link ignoredSpans}
* handles those, and conflating the two is how a fence's opening ticks get
* mistaken for an unclosed inline span.
*/
function codeSpanEnd(text, start) {
	let ticks = 0;
	let i = start;
	while (i < text.length && text.charAt(i) === "`") {
		ticks += 1;
		i += 1;
	}
	if (ticks === 0 || ticks >= 3) return -1;
	let end = i;
	while (end < text.length) {
		if (text.charAt(end) !== "`") {
			end += 1;
			continue;
		}
		let closingTicks = 0;
		let j = end;
		while (j < text.length && text.charAt(j) === "`") {
			closingTicks += 1;
			j += 1;
		}
		if (closingTicks === ticks) return j;
		end = j;
	}
	return -1;
}
/** CDATA / comment / processing instruction at `index`, if one starts there. */
function xmlIgnoredEnd(text, index) {
	for (const [open, close] of [
		["<![CDATA[", "]]>"],
		["<!--", "-->"],
		["<?", "?>"]
	]) {
		if (!text.startsWith(open, index)) continue;
		const found = text.indexOf(close, index + open.length);
		if (found === -1) return {
			start: index,
			end: text.length,
			open: true
		};
		return {
			start: index,
			end: found + close.length,
			open: false
		};
	}
}
/**
* Index just past the ignored span containing `index`, or `index` unchanged.
*
* `cursor` is a hint into the sorted span list; callers that walk positions in
* order get O(1) amortised lookup, which is why the parameter exists.
*/
function skipIgnored(spans, index, cursor) {
	while (cursor.at < spans.length) {
		const span = spans[cursor.at];
		if (span === void 0 || index < span.start) return index;
		if (index < span.end) return span.end;
		cursor.at += 1;
	}
	return index;
}
/**
* Length of the marker prefix at `index`, or 0 when none is there.
*
* Two passes on purpose. The literal spellings are tried first; then the text
* is normalised character by character, which is the only way to recognise a
* block that mixes the two bar styles — and mixing is normal: one captured
* emission spelled the opening tags with single bars and the closer with double.
*/
function prefixLengthAt(text, index) {
	for (const prefix of MARKUP_PREFIXES) if (text.startsWith(prefix, index)) return prefix.length;
	const normalized = normalizeFullwidth(text.slice(index, index + 8));
	for (const prefix of ASCII_PREFIXES) if (normalized.startsWith(prefix)) return prefix.length;
	return 0;
}
/** Is a single character usable inside a tag name? Mirrors Python's `isalnum()`. */
function isNameCharacter(text, index) {
	return /[\p{L}\p{N}_-]/u.test(text.charAt(index));
}
/** Read a tag name at `index` (after any marker prefix). */
function readName(text, index) {
	const prefixLength = prefixLengthAt(text, index);
	const marked = prefixLength > 0;
	let position = index + prefixLength;
	while (position < text.length && /\s/.test(text.charAt(position))) position += 1;
	const start = position;
	while (position < text.length && isNameCharacter(text, position)) position += 1;
	if (position === start) return {
		name: "",
		end: index,
		marked
	};
	return {
		name: text.slice(start, position).toLowerCase(),
		end: position,
		marked
	};
}
/**
* Scan a tag at `index`, or nothing when there is not one.
*
* Any name is accepted (the model invents parameter tags freely); only the ones
* in {@link CANONICAL_TAG_NAMES} are normalised, and the misspellings are
* normalised only in a marker form — `<toolcalls>` alone is somebody's HTML.
*/
function scanTag(text, index) {
	if (text.charAt(index) !== "<") return void 0;
	let position = index + 1;
	let closing = false;
	if (text.charAt(position) === "/") {
		closing = true;
		position += 1;
	}
	while (position < text.length && /\s/.test(text.charAt(position))) position += 1;
	const read = readName(text, position);
	if (read.name === "") return void 0;
	const canonical = CANONICAL_TAG_NAMES.get(read.name);
	const name = canonical !== void 0 && !(MARKER_ONLY_TAG_NAMES.has(read.name) && !read.marked) ? canonical : read.name;
	const attributesStart = read.end;
	let selfClosing = false;
	let cursor = read.end;
	while (cursor < text.length) {
		const character = text.charAt(cursor);
		if (character === ">") return {
			start: index,
			end: cursor,
			name,
			closing,
			selfClosing,
			marked: read.marked,
			attributes: text.slice(attributesStart, cursor).trim()
		};
		if (character === "/" && text.charAt(cursor + 1) === ">") {
			selfClosing = true;
			return {
				start: index,
				end: cursor + 1,
				name,
				closing,
				selfClosing,
				marked: read.marked,
				attributes: text.slice(attributesStart, cursor).trim()
			};
		}
		cursor += 1;
	}
}
/** The next markup tag outside every ignored span, at or after `from`. */
function findTag(text, spans, from) {
	const cursor = { at: 0 };
	let index = Math.max(from, 0);
	while (index < text.length) {
		const skipped = skipIgnored(spans, index, cursor);
		if (skipped !== index) {
			index = skipped;
			continue;
		}
		if (text.charAt(index) === "<") {
			const tag = scanTag(text, index);
			if (tag !== void 0) return tag;
		}
		index += 1;
	}
}
/**
* The close tag matching `open`, or nothing when it has not arrived yet.
*
* Depth counting so a nested block of the same name cannot terminate its parent
* early. This is gate 1's teeth: no close, no call.
*/
function findMatchingClose(text, spans, open) {
	let depth = 1;
	let index = open.end + 1;
	while (index < text.length) {
		const tag = findTag(text, spans, index);
		if (tag === void 0) return void 0;
		if (tag.name === open.name) {
			if (tag.closing) {
				depth -= 1;
				if (depth === 0) return tag;
			} else if (!tag.selfClosing) depth += 1;
		}
		index = tag.end + 1;
	}
}
/**
* The first block-opening tag in `text`, with its close when one has arrived.
*
* The close is OPTIONAL on purpose, and the two callers need it differently:
* the buffer holds from `open` while it is missing (gate 1 — the block may
* still complete), whereas parsing already-complete text stops rather than
* correcting a broken block and then trusting what follows it.
*/
function findFirstOpener(text, spans) {
	let index = 0;
	while (index < text.length) {
		const tag = findTag(text, spans, index);
		if (tag === void 0) return void 0;
		if (!tag.closing && BLOCK_TAGS.includes(tag.name)) {
			const close = findMatchingClose(text, spans, tag);
			return close === void 0 ? { open: tag } : {
				open: tag,
				close
			};
		}
		index = tag.end + 1;
	}
}
/** Decode the five predefined XML entities plus numeric references. */
function decodeEntities(text) {
	if (!text.includes("&")) return text;
	const named = /* @__PURE__ */ new Map([
		["amp", "&"],
		["lt", "<"],
		["gt", ">"],
		["quot", "\""],
		["apos", "'"]
	]);
	return text.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
		if (body.startsWith("#")) {
			const hex = body.charAt(1).toLowerCase() === "x";
			const digits = hex ? body.slice(2) : body.slice(1);
			const code = Number.parseInt(digits, hex ? 16 : 10);
			if (!Number.isFinite(code) || code <= 0 || code > 1114111) return whole;
			return String.fromCodePoint(code);
		}
		return named.get(body.toLowerCase()) ?? whole;
	});
}
/** `name="value"` / `name='value'` pairs, entities decoded. */
function parseAttributes(text) {
	const attributes = {};
	const pattern = /([a-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
	let match = pattern.exec(text);
	while (match !== null) {
		const key = match[1];
		const value = match[2] ?? match[3];
		if (key !== void 0 && value !== void 0) attributes[key] = decodeEntities(value);
		match = pattern.exec(text);
	}
	return attributes;
}
/**
* Parse the parameters inside one block body.
*
* Two shapes, in the order the model prefers them:
*   - `<｜DSML｜parameter name="cmd">value</…parameter>` (the explicit form);
*   - `<cmd>value</cmd>` (the tag name IS the parameter name), used only when
*     the explicit form has not already claimed that name — otherwise a nested
*     tag echoing it would overwrite the real value.
*
* A `CDATA` body is taken verbatim; everything else is entity-decoded.
*
* Every scanner here computes its ignored spans from the string it is about to
* scan. Span offsets are only meaningful against the text they were measured
* on, and a body is a substring of its parent — reusing the parent's offsets
* would misplace every fence and silently turn "quoted markup" into "called
* markup", which is gate 4's worst failure. Each of these strings is small, so
* recomputing is cheaper than passing a coordinate system around.
*/
function parseParameters(body) {
	const parameters = {};
	const spans = ignoredSpans(body);
	let index = 0;
	while (index < body.length) {
		const tag = findTag(body, spans, index);
		if (tag === void 0) break;
		if (tag.closing || tag.selfClosing) {
			index = tag.end + 1;
			continue;
		}
		const close = findMatchingClose(body, spans, tag);
		if (close === void 0) {
			index = tag.end + 1;
			continue;
		}
		const value = body.slice(tag.end + 1, close.start).trim();
		const attributes = parseAttributes(tag.attributes);
		const explicitName = tag.name === "parameter" ? attributes["name"] : void 0;
		const name = explicitName ?? tag.name;
		if (name !== void 0 && name !== "" && (explicitName !== void 0 || parameters[name] === void 0)) parameters[name] = value.startsWith("<![CDATA[") && value.endsWith("]]>") ? value.slice(9, -3) : nestedOrText(value);
		index = close.end + 1;
	}
	return parameters;
}
/** A value that itself contains a complete tag pair is a nested object. */
function nestedOrText(value) {
	if (!value.includes("<") || !value.includes(">")) return decodeEntities(value);
	const nested = parseParameters(value);
	return Object.keys(nested).length > 0 ? nested : decodeEntities(value);
}
/**
* One block's worth of text → the calls it declares, or nothing.
*
* This is where gates 2 and 4 live. Returning nothing is the COMMON case for
* mistaken input and is not an error: callers must show the block verbatim.
*/
function parseBlock(block, gate) {
	const calls = [];
	const spans = ignoredSpans(block);
	let index = 0;
	while (index < block.length) {
		const tag = findTag(block, spans, index);
		if (tag === void 0) break;
		if (!tag.closing && tag.name === "invoke") {
			const close = findMatchingClose(block, spans, tag);
			if (close === void 0) break;
			const call = parseInvoke(tag, close, block, gate);
			if (call !== void 0) calls.push(call);
			index = close.end + 1;
			continue;
		}
		index = tag.end + 1;
	}
	return calls;
}
/** One `<invoke>` element → a call, or nothing when a gate refuses it. */
function parseInvoke(open, close, block, gate) {
	const name = parseAttributes(open.attributes)["name"];
	if (name === void 0 || name === "") return void 0;
	if (!gate.declaredNames.has(name)) return void 0;
	const pinned = gate.pinnedToolName;
	if (pinned !== void 0 && pinned !== "auto" && pinned !== "required" && pinned !== "none" && pinned !== name) return;
	const parameters = parseParameters(block.slice(open.end + 1, close.start));
	const required = gate.requiredParameters?.get(name);
	if (required !== void 0 && required.some((parameter) => parameters[parameter] === void 0)) return void 0;
	return {
		id: `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
		name,
		arguments: JSON.stringify(parameters)
	};
}
/**
* `text` with every markup block removed — the check behind {@link hasProse}.
*
* ANY marker-bearing tag counts as markup, whatever it is called. Keying on the
* known names alone was the first attempt and it got the one shape this project
* has actually captured wrong: `<｜DSML｜ validate>` carries an invented name
* (`validate` is the TOOL name, written where `invoke name="…"` belongs), so a
* keyword-only rule left it standing, the response was classified as prose, and
* the retry-when-the-turn-produced-nothing rule could never fire for the very
* leak it was written for — a check that never fires, which is the trap this
* project has already paid for twice.
*
* Removal reaches the matching close only for names that bracket content
* ({@link KEYWORD_TAGS}); an invented name removes just its own tag, because
* nothing says it opens anything.
*
* Ignored spans are KEPT: a fenced or back-ticked quotation of the marker is
* prose, and the rule is explicitly about a turn that produced nothing usable.
*/
function stripMarkup(text) {
	const spans = ignoredSpans(text);
	const cursor = { at: 0 };
	let result = "";
	let index = 0;
	while (index < text.length) {
		const skipped = skipIgnored(spans, index, cursor);
		if (skipped !== index) {
			result += text.slice(index, skipped);
			index = skipped;
			continue;
		}
		const tag = text.charAt(index) === "<" ? scanTag(text, index) : void 0;
		if (tag === void 0 || !tag.marked) {
			result += text.charAt(index);
			index += 1;
			continue;
		}
		const close = !tag.closing && !tag.selfClosing && KEYWORD_TAGS.includes(tag.name) ? findMatchingClose(text, spans, tag) : void 0;
		index = close === void 0 ? tag.end + 1 : close.end + 1;
	}
	return result;
}
/**
* Does `text` carry content outside markup blocks?
*
* This is what makes "the turn produced nothing usable" a checkable fact rather
* than a guess: a response whose only content is markup residue returns false,
* and the caller may then consider a single retry. Text inside a fence or code
* span counts as content — a documented quotation of the marker is prose.
*/
function hasProse(text) {
	return stripMarkup(text).trim() !== "";
}
/**
* Which of `text`'s tail must wait for more bytes.
*
* Two reasons to hold, and only these two:
*   - the tail starts a tag that is not closed yet, and could still turn out to
*     be a block opener (`…<｜DSML｜inv`), so committing it as text would make
*     the block unparseable;
*   - the tail opens a code span whose closer is still in flight, because
*     whether the following markup is *quoted* depends on that span.
*
* Anything else is emitted immediately. In particular a COMPLETE tag that is
* not a block opener — `<｜DSML｜ validate>`, the shape this project actually
* captured — is not held: it is prose as far as this layer is concerned, and
* holding it would delay every ordinary answer that mentions the markup.
*/
function holdFrom(text, spans) {
	let hold = text.length;
	const lastLt = text.lastIndexOf("<");
	if (lastLt !== -1 && looksLikeTagStart(text.slice(lastLt))) hold = Math.min(hold, lastLt);
	for (const span of spans) if (span.open) hold = Math.min(hold, span.start);
	return hold;
}
/**
* Could this fragment be the beginning of a block-opening tag?
*
* Conservative by construction: it requires an unterminated `<`, and after
* stripping an optional `/`, whitespace and marker, the remainder must be a
* prefix of (or extend) a known opener. That is what keeps `a < b`, `<50%` and
* `i < n` in ordinary prose from stalling a stream — each of them either
* contains a `>` or fails the opener test.
*
* A marker that is STILL ARRIVING also holds (`<｜`, `<｜DSML`, `||D`). Without
* that case the leading `<｜` is emitted as text the moment it arrives, and the
* block can never be recovered afterwards because its opening tag has already
* been split in two — a byte-by-byte feed is how this was found, and the
* reference implementation has the same hole.
*/
function looksLikeTagStart(tail) {
	if (!tail.startsWith("<")) return false;
	if (tail.includes(">")) return false;
	let body = tail.slice(1);
	if (body.startsWith("/")) body = body.slice(1);
	if (body === "" || isPartialMarker(body)) return true;
	const prefixLength = prefixLengthAt(body, 0);
	body = body.slice(prefixLength).trim().toLowerCase();
	if (body === "" || isPartialMarker(body)) return true;
	return [
		"tool",
		"invoke",
		"tool_calls",
		"tool-calls",
		"toolcalls",
		"tool_call",
		"tool-call"
	].some((opener) => opener.startsWith(body) || body.startsWith(opener));
}
/**
* Is this the start of a marker whose remainder has not arrived yet?
*
* Compared both literally and full-width-normalised, because the model mixes
* the two bar styles and a mixture splits at an unpredictable character.
*/
function isPartialMarker(body) {
	const trimmed = body.trimStart();
	if (trimmed === "") return true;
	const forms = [...MARKUP_PREFIXES, ...ASCII_PREFIXES];
	return [trimmed, normalizeFullwidth(trimmed.slice(0, 8))].some((candidate) => candidate !== "" && forms.some((form) => form.startsWith(candidate) && candidate.length < form.length));
}
/** Full-width ASCII (U+FF01..U+FF5E) mapped to its ASCII counterpart. */
function normalizeFullwidth(text) {
	let normalized = "";
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		normalized += code >= 65281 && code <= 65374 ? String.fromCodePoint(code - 65248) : character;
	}
	return normalized;
}
/**
* Buffers `delta.content` and commits a call only when the block that declares
* it is complete.
*
* Ported from the reference's `ToolCallStreamBuffer` with its hard-won
* behaviour intact:
*
*   - a block with no close tag yet holds the ENTIRE block (not a partial
*     guess), and only the tail that could still become a tag is held back
*     from otherwise-finished text;
*   - a block that fails the gates is emitted VERBATIM (gate 4), not dropped;
*   - {@link flush} hands back whatever is still held, so a truncated block
*     loses none of its text.
*
* The reference's own comment explains why the tail rule is not "hold
* everything from the first `<`": an architecture document that shows
* `<tool_calls><invoke>` as an EXAMPLE would otherwise starve the rest of the
* response until the stream ended, and then lose it.
*/
var DsmlStreamBuffer = class {
	pending = "";
	gate;
	constructor(gate) {
		this.gate = gate;
	}
	/** Feed one `delta.content` chunk; returns text and any call it completed. */
	add(chunk) {
		this.pending += chunk;
		const parts = [];
		const calls = [];
		if (this.gate.declaredNames.size === 0) {
			const text = this.pending;
			this.pending = "";
			return {
				text,
				prose: hasProse(text)
			};
		}
		for (;;) {
			const found = findFirstOpener(this.pending, ignoredSpans(this.pending));
			if (found === void 0) break;
			const head = this.pending.slice(0, found.open.start);
			if (head !== "") parts.push(head);
			if (found.close === void 0) {
				this.pending = this.pending.slice(found.open.start);
				return finish(parts, calls);
			}
			const body = this.pending.slice(found.open.start, found.close.end + 1);
			const recovered = parseBlock(body, this.gate);
			if (recovered.length > 0) calls.push(...recovered);
			else parts.push(body);
			this.pending = this.pending.slice(found.close.end + 1);
		}
		const hold = holdFrom(this.pending, ignoredSpans(this.pending));
		if (hold > 0) parts.push(this.pending.slice(0, hold));
		this.pending = this.pending.slice(hold);
		return finish(parts, calls);
	}
	/** End of stream: hand back everything still held, verbatim. */
	flush() {
		const text = this.pending;
		this.pending = "";
		return {
			text,
			prose: hasProse(text)
		};
	}
};
/** Assemble one `add()` outcome without ever emitting a `calls: undefined` key. */
function finish(parts, calls) {
	const text = parts.join("");
	const outcome = {
		text,
		prose: hasProse(text)
	};
	if (calls.length > 0) outcome.calls = [...calls];
	return outcome;
}
//#endregion
//#region src/shim.ts
/**
* Loopback OpenAI-compatible endpoint. The pi-ai provider points here; the
* shim applies the WorkBuddy wire quirks (forced streaming, string
* `tool_choice`, CLI-shaped headers) and forwards to the real upstream.
* It binds 127.0.0.1 only and never serves another interface.
*
* 参考：corrinehu/dsh-workbuddy-connect（MIT，Copyright (c) 2026 Corrine Hu）
*   — 入站加固的四重校验（Host 必须回环、Origin 必须回环、chat POST 必须
*     JSON、bearer 必须匹配进程内随机 secret）、常量时间比对、
*     随机端口绑定、body 上限、上游错误分类到 HTTP 状态码的映射，
*     均由该项目设计并验证。
* 改动：无。安全相关代码不做「改善」，原样沿用。

* @module dsh-connect-workbuddy/shim
*/
const REQUEST_BODY_LIMIT = 67108864;
/**
* Pause between failover attempts, after one account's request failed.
*
* The upstream's rate limit (6004) fires on request volume — firing retries at
* zero gap makes every candidate hit the same wall, and 4 accounts can all fail
* in under a second. The batch test already waits `POOL_BATCH_GAP_MS` (400ms)
* between accounts for exactly this reason; the failover loop used to wait
* nothing. 2 seconds is longer than the batch's 400 because a failover retry is
* a real request the user is waiting on, not a probe — it needs enough room for
* the upstream's window to breathe, not just enough to avoid self-inflicted
* rate-limiting.
*/
const FAILOVER_ACCOUNT_GAP_MS = 2e3;
/** Loopback hostnames the shim's own in-process client uses. */
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"localhost",
	"[::1]"
]);
/** Strip the optional :port from a Host header value, IPv6-bracket aware. */
function hostnameOfHost(host) {
	let hostname = host.trim().toLowerCase();
	if (hostname.startsWith("[")) {
		const end = hostname.indexOf("]");
		return end === -1 ? hostname : hostname.slice(0, end + 1);
	}
	const colon = hostname.lastIndexOf(":");
	if (colon !== -1 && /^\d+$/.test(hostname.slice(colon + 1))) hostname = hostname.slice(0, colon);
	return hostname;
}
/**
* The request's Host header must name the loopback interface. A DNS-rebinding
* page (attacker domain re-resolved to 127.0.0.1) sends its own domain in
* Host, so this check drops those before any routing happens.
*/
function hostIsLoopback(host) {
	if (host === void 0 || host.trim() === "") return false;
	return LOOPBACK_HOSTS.has(hostnameOfHost(host));
}
/**
* A browser-sent Origin (present header) must be loopback. Non-browser
* clients (the plugin's own fetch calls) send no Origin at all and pass.
*/
function originIsLoopback(origin) {
	if (origin === void 0 || origin.trim() === "") return true;
	try {
		const { hostname } = new URL(origin);
		return LOOPBACK_HOSTS.has(hostname) || hostname === "::1";
	} catch {
		return false;
	}
}
/** Chat-completion POSTs must carry a JSON body type (simple-request CSRF drops here). */
function isJsonContentType(req) {
	const type = req.headers["content-type"];
	return typeof type === "string" && type.trim().toLowerCase().startsWith("application/json");
}
/** HTTP status each upstream failure class surfaces as. */
const KIND_STATUS = {
	hard_credit: 402,
	soft_rate: 429,
	session_dead: 401,
	policy_reject: 403,
	not_found: 502,
	server: 502,
	client: 400
};
/**
* The `code` spelling the HOST is expected to classify each upstream failure by.
*
* The host decides whether a failed request may be retried IN PLACE (5 attempts
* with backoff) or must be handed to cross-provider failover by reading English
* phrases out of `type + " " + code + " " + message` — see
* `isQuotaExceededError` in `@deepseek-ai/dsh-llm`. Only `RATE_LIMIT`, `SERVER`,
* `TIMEOUT`, `TRANSPORT` and `EMPTY_RESPONSE` are in its retry set, so the
* spelling decides which of two very different things happens next.
*
* `soft_rate` is the one kind that spelling got wrong. The upstream's 429 says
* "usage exceeds the frequency limit, and it resets at 13:37" — hours away, not
* two seconds. Sent as `soft_rate` it reads as an ordinary rate limit, enters
* the in-place retry set, and spends the whole retry budget on an endpoint that
* cannot recover within it; by the time cross-provider failover is offered, the
* turn has already failed. The upstream's own words are Chinese, so the
* phrase-based classifier cannot see the distinction either — the label is the
* only channel left to carry it.
*
* `quota_exceeded` is the minimal honest translation: it is the WORDS the host
* recognises, and it matches what the upstream is actually saying. The HTTP
* status stays 429 (that is what the upstream returned — relabelling it 402
* would misreport the upstream), and the upstream's own message is still passed
* through verbatim for a human to read.
*
* Every other kind already lands outside the retry set by its status alone
* (`hard_credit` 402 → quota, `session_dead` 401 → auth, 502/400 → other), so
* none of them is listed: a translation nobody needs is a lie waiting to drift.
*
* `policy_reject` is deliberately NOT listed either, for a sharper reason than
* the others: the obvious candidate translation would be the upstream's own
* numeric code (11140), but that is not a class the host knows, so it would take
* the host's generic path and add nothing over `policy_reject`. It needs no
* translation to stay outside the retry set (403), and it must NOT be translated
* INTO the set — a content-policy refusal is deterministic, so retrying it in
* place would spend the retry budget on a request the server will refuse again,
* and cross-provider failover cannot help a policy decision either. The code the
* host receives therefore names the class honestly.
*/
const KIND_HOST_CODE = { soft_rate: "quota_exceeded" };
/**
* The `code` to write for an upstream failure, given its classified kind.
*
* `type` deliberately stays the plugin's own kind: it is what a human reads in
* a log or a bug report, and it keeps the two fields individually meaningful.
* Only `code` carries the host-facing translation.
*/
function hostErrorCode(kind) {
	return KIND_HOST_CODE[kind] ?? kind;
}
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
/**
* Write a JSON error the way an OpenAI-compatible client expects.
*
* `code` defaults to `type`, which is right for every error THIS shim raises on
* its own (`unauthorized`, `not_found`, …): those are not upstream failures and
* must not be disguised as one. The upstream failure path passes an explicit
* `code` so the host classifies it correctly — see {@link KIND_HOST_CODE}.
*/
function writeOpenAIError(res, status, kind, message, code) {
	writeJson(res, status, { error: {
		message,
		type: kind,
		code: code ?? kind
	} });
}
/** Read a request body with a size cap; over-limit bodies fail the request. */
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > REQUEST_BODY_LIMIT) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}
/**
* Rewrites the upstream SSE stream, converting markup the model wrote into the
* text back into a real `delta.tool_calls` — and, when a whole turn produced
* nothing but markup, holding the bytes long enough to retry ONCE.
*
* ============================================================================
* Why this class exists rather than a `.pipe()`
* ============================================================================
*
* Recovering a call means inspecting `delta.content` before the client sees it,
* which the old `body.pipe(res)` could not do. The parsing rules live in
* `src/dsml-recovery.ts`; everything here is about the STREAM's obligations:
*
*   1. FRAME ORDER IS NEVER CHANGED. Frames are forwarded in arrival order.
*      The only frame this class invents is the trailing one that carries a
*      block still unfinished at end-of-stream.
*
*   2. HOLDS ARE TEMPORARY AND PAY FOR THEMSELVES. Nothing is held unless the
*      answer so far consists only of markup: the moment real prose or a real
*      call appears, everything held is flushed in order and the stream returns
*      to plain pass-through. An ordinary answer therefore pays no latency at
*      all, and no byte is ever discarded while a retry is still possible.
*
*   3. A RETRY MUST NOT SPLICE TWO ANSWERS TOGETHER. That constraint is why the
*      hold exists: because no content frame has been written yet, the caller
*      can discard this attempt and re-send the same body. The existing
*      failover loop makes the same promise for failures BEFORE the stream
*      starts (see its comment in `chatCompletions`); this extends it to the
*      one case that can only be recognised after the fact.
*
*   4. NOTHING IS INVENTED WHEN THE UPSTREAM ALREADY SPEAKS STRUCTURED CALLS.
*      Once a native `delta.tool_calls` appears, recovery switches off for the
*      rest of the response — two live call channels for one answer is worse
*      than either one alone.
*/
var RecoveryStream = class {
	res;
	logger;
	carry = "";
	decoder = new TextDecoder("utf-8");
	/** Frames received after the hold began, in arrival order. */
	held = [];
	/**
	* The hold window, as two separate facts.
	*
	* `windowOpened` becomes true at the FIRST content-bearing frame and stays
	* true: before it, frames carry no answer (a role delta, a keep-alive) and go
	* straight out; from it on, they are held until the answer is known to be
	* real. `windowClosed` means "an answer was delivered", after which every
	* frame passes through again — for the rest of the response, because a turn
	* that has already produced prose can no longer be replaced by a retry.
	*/
	windowOpened = false;
	windowClosed = false;
	wroteContent = false;
	sawResidue = false;
	sawDone = false;
	/**
	* Set once the upstream speaks structured calls.
	*
	* Sticky for the whole response on purpose: recovering markup into a second
	* call channel after the upstream already produced a real one would hand the
	* client two answers to the same question.
	*/
	nativeCallsSeen = false;
	buffer;
	/**
	* A notice to place at the head of the answer, once, before any prose.
	*
	* Set when the request reached this stream only after the pool failed over, so
	* the user learns WHY the answer came from a different account. Without it a
	* failover is invisible: the reply looks like it came from the account they
	* picked, and the only trace is a `logger.warn` they never see. The notice is
	* emitted ahead of the model's own text so it cannot be mistaken for part of
	* the answer, and only once — a retry that never delivers text must not leave
	* a stray line behind.
	*/
	notice;
	constructor(res, gate, logger, notice) {
		this.res = res;
		this.logger = logger;
		this.buffer = gate === void 0 ? void 0 : new DsmlStreamBuffer(gate);
		this.notice = notice;
	}
	/**
	* Emit the pending failover notice, if any, and forget it.
	*
	* Called immediately before the first content reaches the client. Placed
	* here rather than in the constructor because a stream whose write fails, or
	* whose attempt is discarded in favour of a retry, must not have already told
	* the user about a switch it never completed.
	*/
	flushNotice() {
		const notice = this.notice;
		if (notice === void 0) return;
		this.notice = void 0;
		if (!this.res.writable) return;
		const chunk = { choices: [{
			index: 0,
			delta: {},
			finish_reason: ""
		}] };
		const choiceRecord = {
			index: 0,
			delta: {},
			finish_reason: ""
		};
		this.windowOpened = true;
		this.res.write(contentFrame(chunk, choiceRecord, notice));
	}
	/** True when a call or real prose has reached the client. */
	get delivered() {
		return this.wroteContent;
	}
	/** True when the held bytes contain markup the gates refused. */
	get residueSeen() {
		return this.sawResidue;
	}
	/** Record that text the gates refused was seen (markup residue, not prose). */
	noteResidue(seen) {
		this.sawResidue ||= seen;
	}
	/** Drain one upstream body into the client. */
	async consume(body) {
		if (body === null) return;
		const source = Readable.fromWeb(body);
		try {
			for await (const chunk of source) this.push(this.decoder.decode(chunk, { stream: true }));
		} catch (error) {
			this.logger?.warn("dsh-connect-workbuddy: upstream stream failed mid-flight", error);
		}
		const tail = this.carry;
		this.carry = "";
		if (tail !== "") this.handleFrame(tail);
	}
	/**
	* Close the response: emit the block still unfinished at end-of-stream, then
	* everything held, then the terminator.
	*/
	finish() {
		const flushed = this.buffer?.flush();
		if (flushed !== void 0 && flushed.text !== "") {
			this.noteResidue(!flushed.prose);
			this.emitContent(flushed.text);
		}
		this.closeWindow();
		if (!this.sawDone && this.res.writable) this.res.write("data: [DONE]\n\n");
		if (this.res.writable) this.res.end();
	}
	/** Drop held bytes without writing them (used when a retry replaced them). */
	discard() {
		this.held = [];
		this.windowClosed = true;
	}
	/** Split incoming bytes into whole SSE frames, handling chunk boundaries. */
	push(text) {
		this.carry += text;
		let start = 0;
		for (;;) {
			const newline = this.carry.indexOf("\n", start);
			if (newline === -1) break;
			if (this.carry.slice(start, newline).trim() === "") {
				const frame = this.carry.slice(0, newline + 1);
				this.carry = this.carry.slice(newline + 1);
				start = 0;
				this.handleFrame(frame);
				continue;
			}
			start = newline + 1;
		}
	}
	/** Handle one complete frame, rewriting it only when recovery produced something. */
	handleFrame(frame) {
		const payload = dataPayload(frame);
		if (payload === void 0) {
			this.send(frame, false);
			return;
		}
		if (payload === "[DONE]") {
			this.sawDone = true;
			this.send(frame, false);
			return;
		}
		let chunk;
		try {
			chunk = JSON.parse(payload);
		} catch {
			this.send(frame, false);
			return;
		}
		const choices = chunk["choices"];
		const choice = Array.isArray(choices) ? choices[0] : void 0;
		if (typeof choice !== "object" || choice === null || Array.isArray(choice)) {
			this.send(frame, false);
			return;
		}
		const choiceRecord = choice;
		const deltaValue = choiceRecord["delta"];
		const delta = typeof deltaValue === "object" && deltaValue !== null && !Array.isArray(deltaValue) ? deltaValue : void 0;
		if (delta === void 0) {
			this.send(frame, false);
			return;
		}
		const nativeCalls = delta["tool_calls"];
		if (Array.isArray(nativeCalls) && nativeCalls.length > 0) {
			this.nativeCallsSeen = true;
			this.windowOpened = true;
			this.flushNotice();
			this.send(frame, false);
			this.wroteContent = true;
			this.closeWindow();
			return;
		}
		const content = delta["content"];
		if (typeof content !== "string" || content === "") {
			const reason = finishReasonOf(choiceRecord);
			if (reason !== "") this.drainBuffer();
			this.send(frame, reason !== "");
			return;
		}
		if (this.buffer === void 0 || this.nativeCallsSeen) {
			this.windowOpened = true;
			this.flushNotice();
			this.closeWindow();
			this.res.write(frame);
			this.wroteContent = true;
			return;
		}
		this.windowOpened = true;
		const outcome = this.buffer.add(content);
		if (outcome.calls !== void 0 && outcome.calls.length > 0) {
			this.flushNotice();
			this.send(callsFrame(chunk, choiceRecord, outcome.calls), false);
			this.wroteContent = true;
			this.closeWindow();
			if (outcome.text !== "") this.res.write(contentFrame(chunk, choiceRecord, outcome.text));
			return;
		}
		this.noteResidue(!outcome.prose && outcome.text !== "");
		if (outcome.text === "") {
			this.send(contentFrame(chunk, choiceRecord, ""), false);
			return;
		}
		if (outcome.prose) {
			this.flushNotice();
			this.send(contentFrame(chunk, choiceRecord, outcome.text), false);
			this.wroteContent = true;
			this.closeWindow();
			return;
		}
		this.send(contentFrame(chunk, choiceRecord, outcome.text), false);
	}
	/**
	* Hand back whatever the buffer is still holding, right now.
	*
	* Called before a terminator frame is forwarded. `flush()` ends the buffer's
	* attempt — if content somehow keeps arriving afterwards it starts a fresh
	* one, which is the correct reading of a stream that declared itself finished.
	*/
	drainBuffer() {
		const flushed = this.buffer?.flush();
		if (flushed === void 0 || flushed.text === "") return;
		this.noteResidue(!flushed.prose);
		this.emitContent(flushed.text);
	}
	/**
	* Emit text the buffer was still holding when the stream ended.
	*
	* It goes through `send` + `closeWindow` rather than straight to the socket on
	* purpose: a `finish_reason` frame may already be queued, and this text is
	* content that logically precedes it. Writing directly would put the answer
	* after its own terminator — a client that stops accumulating at
	* `finish_reason` would silently lose the tail.
	*/
	emitContent(text) {
		const chunk = { choices: [{
			index: 0,
			delta: {},
			finish_reason: ""
		}] };
		const choiceRecord = {
			index: 0,
			delta: {},
			finish_reason: ""
		};
		this.windowOpened = true;
		const frame = contentFrame(chunk, choiceRecord, text);
		if (text.trim() !== "") {
			this.flushNotice();
			this.send(frame, false);
			this.wroteContent = true;
			this.closeWindow();
			return;
		}
		this.send(frame, false);
	}
	/** Queue a frame while the window is open, or write it once it has closed. */
	send(frame, final) {
		if (this.windowClosed || !this.windowOpened) {
			this.res.write(frame);
			return;
		}
		const entry = {
			frame,
			final
		};
		if (!final) {
			const at = this.held.findIndex((item) => item.final);
			if (at !== -1) {
				this.held.splice(at, 0, entry);
				return;
			}
		}
		this.held.push(entry);
	}
	/**
	* An answer has been delivered: flush everything held, in order, and never
	* hold again for this response.
	*/
	closeWindow() {
		this.windowClosed = true;
		const pending = this.held;
		this.held = [];
		for (const entry of pending) this.res.write(entry.frame);
	}
};
/** The SSE `data:` payload of one frame, or nothing when it carries none. */
function dataPayload(frame) {
	for (const line of frame.split("\n")) {
		const trimmed = line.trimEnd();
		if (!trimmed.startsWith("data:")) continue;
		return trimmed.slice(5).trim();
	}
}
/** A frame's `finish_reason`, or '' when it carries none. */
function finishReasonOf(choice) {
	const reason = choice["finish_reason"];
	return typeof reason === "string" ? reason : "";
}
/**
* One frame carrying recovered calls.
*
* The shape is OpenAI's: `index` per call, `type: "function"`, arguments as a
* JSON STRING. `finish_reason` becomes `tool_calls` — without it a client that
* waits for the reason before executing an assembled call would never run it.
*/
function callsFrame(chunk, choice, calls) {
	const toolCalls = calls.map((call, index) => ({
		index,
		id: call.id,
		type: "function",
		function: {
			name: call.name,
			arguments: call.arguments
		}
	}));
	const next = {
		...chunk,
		choices: [{
			...choice,
			delta: { tool_calls: toolCalls },
			finish_reason: "tool_calls"
		}]
	};
	return `data: ${JSON.stringify(next)}\n\n`;
}
/**
* How to name a pool account in a sentence the USER reads.
*
* Prefers the phone number (`uin`) because that is what the pool table shows and
* what a person recognises; the nickname and the opaque account id are fallbacks
* so this can never render an empty name. Deliberately NOT the hashed account id
* on its own: a 24-character hex digest identifies an account to the plugin, but
* to the person reading the answer it identifies nothing.
*/
function describeAccount(credential) {
	if (credential.uin !== void 0 && credential.uin !== "") return credential.uin;
	if (credential.nickname !== void 0 && credential.nickname !== "") return credential.nickname;
	return workbuddyAccountId(credential);
}
/**
* One short phrase for why an account was abandoned, for the in-reply notice.
*
* Kept to the distinction the user can act on rather than the internal kind
* name: "rate limited" says wait or add an account, "rejected" says the sign-in
* is the problem. The numeric kind would only send them to the log.
*/
function failoverReasonText(failure) {
	if (failure.ok) return "unusable";
	switch (failure.kind) {
		case "soft_rate":
		case "hard_credit": return "rate limited";
		case "session_dead": return "signed out";
		case "policy_reject": return "rejected by policy";
		case "not_found": return "model unavailable";
		case "server": return "erroring upstream";
		default: return `unusable (http ${failure.status})`;
	}
}
/**
* The line prepended to an answer that came from a failover account.
*
* Block-quoted and bracketed so it reads as machinery rather than as the model's
* own words, and so a user skimming for the answer can skip it. It states the
* reason AND the account left behind, because those are the two facts that make
* an unexpected reply explicable.
*
* The wording avoids "switched TO <account>" on purpose: the account that took
* over is the one the user is about to keep talking to, and naming it invites
* the reading that they must now manage it. What they need is to know the one
* they chose did not answer, and why.
*/
function failoverNoticeText(from, reason) {
	return `\n\n> [dsh-connect-workbuddy] 「${from}」was ${reason} — this answer came from another account\n\n`;
}
/** One frame carrying replacement text for a frame whose content was consumed. */
function contentFrame(chunk, choice, content) {
	const delta = {
		...choice["delta"],
		content
	};
	const next = {
		...chunk,
		choices: [{
			...choice,
			delta
		}]
	};
	return `data: ${JSON.stringify(next)}\n\n`;
}
/**
* Start the loopback endpoint. Requests must carry the shim's shared secret;
* the loopback bind alone is not a trust boundary.
*/
function createWorkBuddyShim(options) {
	const { store, client, catalog } = options;
	const logger = options.logger;
	const failoverAccount = options.failoverAccount;
	const prepareAccount = options.prepareAccount;
	const onAccountFailure = options.onAccountFailure;
	const SHARED_SECRET = randomBytes(32).toString("base64url");
	/** Constant-time bearer check; absent or mismatched bearers are rejected. */
	function bearerOk(req) {
		const header = req.headers.authorization;
		if (typeof header !== "string") return false;
		const match = /^Bearer\s+(.+)$/i.exec(header.trim());
		if (match === null) return false;
		const presented = match[1];
		const expected = SHARED_SECRET;
		const a = Buffer.from(presented);
		const b = Buffer.from(expected);
		if (a.length !== b.length) return false;
		return timingSafeEqual(a, b);
	}
	const server = createServer((req, res) => {
		handle(req, res);
	});
	const ready = new Promise((resolve, reject) => {
		server.once("listening", () => resolve());
		server.once("error", reject);
	});
	server.listen(0, "127.0.0.1");
	const baseUrl = () => {
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("workbuddy shim has no listening address");
		return `http://127.0.0.1:${address.port}`;
	};
	async function handle(req, res) {
		try {
			if (!hostIsLoopback(req.headers.host)) {
				writeOpenAIError(res, 403, "host_not_allowed", "Host header must name the loopback interface");
				return;
			}
			if (!originIsLoopback(req.headers.origin)) {
				writeOpenAIError(res, 403, "origin_not_allowed", "Origin must be a loopback origin");
				return;
			}
			if (!bearerOk(req)) {
				writeOpenAIError(res, 401, "unauthorized", "missing or invalid Authorization bearer");
				return;
			}
			const url = req.url ?? "/";
			if (req.method === "GET" && (url === "/healthz" || url === "/healthz/")) {
				writeJson(res, 200, { ok: true });
				return;
			}
			if (req.method === "GET" && (url === "/v1/models" || url === "/v1/models/")) {
				writeJson(res, 200, {
					object: "list",
					data: catalog.current().map((model) => ({
						id: model.id,
						object: "model",
						created: 0,
						owned_by: "workbuddy"
					}))
				});
				return;
			}
			if (req.method === "POST" && (url === "/v1/chat/completions" || url === "/v1/chat/completions/")) {
				await chatCompletions(req, res);
				return;
			}
			writeOpenAIError(res, 404, "not_found", `no such route: ${req.method} ${url}`);
		} catch (error) {
			if (!res.headersSent) writeOpenAIError(res, 500, "internal", String(error));
			else res.end();
		}
	}
	/**
	* Failure classes worth retrying against another account.
	*
	* `client` is deliberately NOT one of them: the upstream rejected the
	* REQUEST (malformed body, unsupported field), so every account answers the
	* same 400 and walking the rest of the pool only multiplies the wait before
	* the user sees an error they must act on anyway. Everything else describes a
	* PER-ACCOUNT condition — a rate limit, exhausted credits, a dead session, a
	* gateway that failed this one call — which another account may well survive.
	*/
	function isFailoverWorthy(kind) {
		return kind !== "client";
	}
	async function chatCompletions(req, res) {
		if (!isJsonContentType(req)) {
			writeOpenAIError(res, 415, "unsupported_media_type", "Content-Type must be application/json");
			return;
		}
		await prepareAccount?.().catch((error) => {
			logger?.warn("dsh-connect-workbuddy: pool account selection failed", error);
		});
		let credential;
		try {
			credential = await store.resolve();
		} catch (error) {
			writeOpenAIError(res, 401, "not_signed_in", String(error));
			return;
		}
		const raw = (await readBody(req)).toString("utf8");
		const prepared = prepareChatBody(raw);
		const controller = new AbortController();
		res.on("close", () => controller.abort());
		let result = await client.chatStream(credential, prepared, controller.signal);
		const triedAccountIds = [];
		/**
		* The account the request STARTED on, and the reason it was abandoned.
		*
		* `??=` on the first switch only: if three accounts fail in a row the user
		* cares that the answer did not come from the one they picked, not with a
		* blow-by-blow list of every candidate that was also rate limited.
		*/
		let switchedFrom;
		let switchedBecause;
		/**
		* Tell the plugin about a failed attempt so it can store the measurement.
		*
		* Every failed attempt is reported exactly once, INCLUDING the last one — an
		* account that failed with nobody left to try it is precisely the one the
		* next request must avoid, so reporting only the attempts that had a
		* successor would miss the case that matters most.
		*
		* Reported after the loop rather than inside it, so the account that broke
		* out of the loop is not also reported by the post-loop call. Not awaited: the
		* user is waiting on the retry, and the write only affects later requests.
		*/
		const failures = [];
		const recordAttempt = (credential, failure) => {
			if (failure.ok) return;
			failures.push({
				accountId: workbuddyAccountId(credential),
				failure
			});
		};
		const reportFailures = () => {
			const batch = failures.splice(0, failures.length);
			if (onAccountFailure === void 0) return;
			if (controller.signal.aborted) return;
			for (const entry of batch) {
				if (entry.failure.ok) continue;
				try {
					onAccountFailure(entry.accountId, {
						status: entry.failure.status,
						kind: entry.failure.kind,
						message: entry.failure.message
					});
				} catch (error) {
					logger?.warn("dsh-connect-workbuddy: recording an account failure failed", error);
				}
			}
		};
		while (!result.ok && isFailoverWorthy(result.kind) && failoverAccount !== void 0) {
			if (controller.signal.aborted) break;
			recordAttempt(credential, result);
			triedAccountIds.push(workbuddyAccountId(credential));
			const next = await failoverAccount(triedAccountIds).catch(() => void 0);
			if (next === void 0) break;
			if (triedAccountIds.includes(workbuddyAccountId(next))) break;
			if (controller.signal.aborted) break;
			await new Promise((resolve) => {
				if (controller.signal.aborted) return resolve();
				const timer = setTimeout(resolve, FAILOVER_ACCOUNT_GAP_MS);
				controller.signal.addEventListener("abort", () => {
					clearTimeout(timer);
					resolve();
				}, { once: true });
			});
			if (controller.signal.aborted) break;
			logger?.warn(`dsh-connect-workbuddy: retrying chat on another pool account after ${result.kind} (http ${result.status})`);
			switchedFrom ??= describeAccount(credential);
			switchedBecause ??= failoverReasonText(result);
			credential = next;
			result = await client.chatStream(credential, prepared, controller.signal);
		}
		if (failures.length === 0 || failures[failures.length - 1]?.accountId !== workbuddyAccountId(credential)) recordAttempt(credential, result);
		reportFailures();
		if (!result.ok) {
			const attempts = triedAccountIds.length;
			const note = attempts > 1 ? ` (after trying ${attempts} accounts)` : "";
			if (result.kind === "policy_reject") {
				const detail = result.detail;
				const lead = detail?.displayMsg ?? result.message.slice(0, 200);
				const meta = ["服务端策略拒绝"];
				if (detail?.upstreamCode !== void 0) meta.push(`code ${detail.upstreamCode}`);
				if (detail?.requestId !== void 0) meta.push(`requestId ${detail.requestId}`);
				const message = `${lead}（${meta.join("，")}）${note}。该请求被 WorkBuddy 服务端策略拒绝，重新登录不会解决；可在 WorkBuddy 桌面端用同一账号验证，或切换区域/账号后重试`;
				writeOpenAIError(res, KIND_STATUS[result.kind], result.kind, message, hostErrorCode(result.kind));
				return;
			}
			writeOpenAIError(res, KIND_STATUS[result.kind], result.kind, `workbuddy upstream ${result.kind} (http ${result.status})${note}: ${result.message.slice(0, 400)}`, hostErrorCode(result.kind));
			return;
		}
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
			"X-Accel-Buffering": "no"
		});
		const declared = declaredTools(prepared);
		const gate = declared === void 0 ? void 0 : {
			declaredNames: declared.names,
			requiredParameters: declared.requiredParameters,
			...declared.pinnedToolName === void 0 ? {} : { pinnedToolName: declared.pinnedToolName }
		};
		const notice = switchedFrom === void 0 || switchedBecause === void 0 ? void 0 : failoverNoticeText(switchedFrom, switchedBecause);
		const writer = new RecoveryStream(res, gate, logger, notice);
		await writer.consume(result.response.body);
		if (gate !== void 0 && !writer.delivered && writer.residueSeen && !controller.signal.aborted) {
			logger?.warn("dsh-connect-workbuddy: the turn produced DSML markup only; retrying it once");
			const retryTried = [...triedAccountIds, workbuddyAccountId(credential)];
			let retryCredential = credential;
			for (;;) {
				const attempt = await client.chatStream(retryCredential, prepared, controller.signal);
				if (attempt.ok) {
					writer.discard();
					const retried = new RecoveryStream(res, gate, logger);
					await retried.consume(attempt.response.body);
					retried.finish();
					reportFailures();
					return;
				}
				recordAttempt(retryCredential, attempt);
				if (!isFailoverWorthy(attempt.kind) || failoverAccount === void 0) break;
				if (controller.signal.aborted) break;
				const next = await failoverAccount(retryTried).catch(() => void 0);
				if (next === void 0) break;
				if (retryTried.includes(workbuddyAccountId(next))) break;
				retryTried.push(workbuddyAccountId(next));
				retryCredential = next;
			}
			logger?.warn("dsh-connect-workbuddy: markup-only retry did not start; showing the original text");
		}
		writer.finish();
		reportFailures();
	}
	return {
		ready,
		baseUrl,
		token: () => SHARED_SECRET,
		close: () => new Promise((resolve, reject) => {
			server.close(() => resolve());
			server.closeAllConnections();
			server.once("error", reject);
		})
	};
}
//#endregion
//#region src/probe.ts
/**
* The system message every probe carries.
*
* Not decoration: the international gateway rejects a conversation that does not
* start with a system message (see the module note). A probe that omitted it
* would report every global model as broken.
*/
const PROBE_SYSTEM_PROMPT = "You are a connectivity check. Reply with a single word.";
/**
* Output cap for a probe. One token is enough to prove the model answers.
*
* The probe's cost comes from its INPUT, not its output (see
* {@link DEFAULT_PROBE_INPUT_TOKENS}), so paying for a long completion would add money
* without adding signal.
*/
const PROBE_MAX_TOKENS = 1;
/**
* How much input a probe sends, in tokens.
*
* This is the whole point of the probe, and it is NOT a free choice. The
* upstream's rate limit (business code 6004) fires on request SIZE, measured on
* 2026-09-29 by varying only the input against one account and one model:
*
*   | input     | prompt_tokens the upstream counted | result |
*   | ---       | ---                                | ---    |
*   | ~10       | 38                                 | ok     |
*   | ~1,000    | 1,138                              | ok     |
*   | ~10,000   | 11,138                             | ok     |
*   | ~18,000   | 20,018                             | ok     |
*   | ~25,000   | 25,023                             | ok     |
*   | ~30,000   | ~32k                               | **429 / 6004** |
*
* So the threshold sits between 20k and 30k, a SINGLE large request is enough to
* trip it (it is not a running total), and each account reports its own reset
* time (two accounts at the same moment: `22:20:33` and `00:32:51`).
*
* A probe that sent a handful of tokens answered "usable" while every real
* request in a long conversation was refused — the probe was asking too small a
* question. 25k is sized to be a realistic long-conversation payload.
*
* Renamed from `PROBE_INPUT_TOKENS` to say what it now IS: the DEFAULT, not the
* only possible size. The size is a property of the user's own traffic (see
* {@link probeRequestBody}), so it became a setting; this constant is what an
* unset setting, an older profile, and every existing test mean by "a probe".
*/
const DEFAULT_PROBE_INPUT_TOKENS = 25e3;
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
/**
* A requested probe size reduced to a size this build will actually send.
*
* Anything outside {@link PROBE_INPUT_TOKEN_CHOICES} — `undefined` from an older
* profile, `0` from an unset field, a hand-edited odd number — becomes the
* measured default. Coercing rather than rejecting keeps a hand-edited profile
* working instead of turning one odd value into a failed test batch.
*/
function resolveProbeInputTokens(requested) {
	return requested !== void 0 && PROBE_INPUT_TOKEN_CHOICES.includes(requested) ? requested : DEFAULT_PROBE_INPUT_TOKENS;
}
/**
* Characters per token for the filler text, measured.
*
* Filling with a fixed English sentence, the upstream counted about 4.5
* characters per token. An estimate rather than a bundled tokenizer: the body
* only needs to be the right SIZE CLASS, and the target has ample margin over
* the measured threshold, so estimate error cannot change the verdict.
*/
const CHARS_PER_TOKEN = 4.5;
/** Neutral filler; carries no user content, only volume. */
const FILLER_LINE = "The quick brown fox jumps over the lazy dog. ";
/**
* Build the request body for one probe.
*
* `stream` is forced because the upstream rejects non-streaming chat requests;
* `prepareChatBody` enforces that too, but sending it explicitly keeps this
* function's output valid on its own.
*
* Measured on the built artifact at the DEFAULT size: 112,713 bytes of body, and
* the upstream counted `prompt_tokens: 25023` at a cost of `credit: 0.72`. The
* body bytes and the credit both scale with the size asked for, which is why the
* size is a user setting: a larger probe answers more truthfully for someone
* whose conversations are long, and costs proportionally more to ask.
*/
function probeRequestBody(modelId, inputTokens = DEFAULT_PROBE_INPUT_TOKENS) {
	const targetChars = Math.ceil(resolveProbeInputTokens(inputTokens) * CHARS_PER_TOKEN);
	const filler = FILLER_LINE.repeat(Math.ceil(targetChars / 45));
	return JSON.stringify({
		model: modelId,
		messages: [{
			role: "system",
			content: PROBE_SYSTEM_PROMPT
		}, {
			role: "user",
			content: `${filler}Reply with a single word.`
		}],
		max_tokens: 1,
		stream: true
	});
}
/**
* Parse a `Retry-After` header value into an absolute time.
*
* Both RFC 9110 forms are accepted: delay-seconds (`120`) and an HTTP-date
* (`Wed, 21 Oct 2026 07:28:00 GMT`). Returns undefined for anything else,
* including the negative/zero delays some gateways emit — a "retry now" is not
* a cooldown and reporting it as one would be worse than saying nothing.
*
* `nowMs` is injected so the delay-seconds branch is testable without a clock.
*/
function parseRetryAfter(value, nowMs) {
	if (value === null) return void 0;
	const trimmed = value.trim();
	if (trimmed === "") return void 0;
	if (/^\d+$/u.test(trimmed)) {
		const seconds = Number(trimmed);
		if (!Number.isFinite(seconds) || seconds <= 0) return void 0;
		return nowMs + seconds * 1e3;
	}
	const parsed = Date.parse(trimmed);
	if (Number.isNaN(parsed)) return void 0;
	if (parsed <= nowMs) return void 0;
	return parsed;
}
/**
* The upstream's reset sentence, as its Chinese gateway writes it.
*
* Measured on a live 429 (code 6004), verbatim:
*
*   `您的使用量已超出频率限制，将在 2026-09-30 02:30:30 UTC+8 重置，您也可以切换其他模型继续使用。`
*
* The two halves are captured separately because the second one is the whole
* reason this parser exists: the upstream DOES name a time, and the plugin was
* showing "the upstream gave no time" while the answer was sitting right there
* in the body. The earlier note in this module ("the upstream provides no
* rate-limit metadata") was drawn from the RESPONSE HEADERS alone — true as far
* as it went, and wrong as a conclusion, because the time is in the body text.
*
* Deliberately loose about the surrounding wording (`[\s\S]*?` on both sides)
* and strict about the parts that must not be guessed: the keyword 重置, the
* timestamp shape, and an explicit UTC offset. A message that merely mentions
* 重置 without a parsable offset yields no time, which is the honest answer.
*/
const UPSTREAM_RESET_PATTERN = /将在?\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*UTC\s*([+-])(\d{1,2})(?::?(\d{2}))?[\s\S]*?重置/u;
/**
* Parse the reset time out of an upstream failure message.
*
* Returns epoch ms, or undefined when the message names no parsable time — the
* caller must then say "the upstream gave no time", never invent one.
*
* THE OFFSET IS HONOURED, NOT ASSUMED. `2026-09-30 02:30:30 UTC+8` is 18:30:30
* UTC the previous day, and `Date.parse` on the bare string would read it as
* LOCAL time — on a machine set to UTC+8 that happens to be right, and on any
* other machine it is silently wrong by the offset. So the components are
* assembled with `Date.UTC` and the stated offset subtracted, which is correct
* on every host regardless of its own zone.
*
* A whole-second resolution is what the upstream prints; sub-second precision
* would be fiction in the other direction.
*/
function parseUpstreamResetAt(message) {
	const match = UPSTREAM_RESET_PATTERN.exec(message);
	if (match === null) return void 0;
	const [, year, month, day, hour, minute, second, sign, offsetHours, offsetMinutes] = match;
	const offsetTotalMinutes = (sign === "-" ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes ?? "0"));
	const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
	const parsed = new Date(utcMs);
	if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day) || parsed.getUTCHours() !== Number(hour) || parsed.getUTCMinutes() !== Number(minute) || parsed.getUTCSeconds() !== Number(second)) return;
	if (Math.abs(offsetTotalMinutes) > 840) return void 0;
	return utcMs - offsetTotalMinutes * 6e4;
}
/**
* The cooldown the upstream stated, if it stated one.
*
* Three sources, in order of authority:
*
* 1. `Retry-After` on the failure response. This is the upstream naming a time
*    for THIS request, so it wins.
* 2. The reset time the upstream writes into its own failure body (see
*    {@link parseUpstreamResetAt}). This is the case that actually fires on
*    this service: a 429 from the Chinese gateway carries code 6004 and a
*    `将在 … 重置` sentence, with no `Retry-After` header at all.
* 3. The region's monthly quota refresh point, but ONLY for an out-of-credit
*    outcome. A quota that resets at a known time is the one case where "when
*    can I use this again" has a real answer even without a header — and it is
*    the answer for the most common real limit on this service.
*
* A limited outcome with none of the three returns `{}`, which the card renders
* as "the upstream did not say when". That remains the honest answer for a
* genuinely timeless failure; inventing a number here would be pure fiction.
*/
function cooldownOf(input) {
	const fromHeader = parseRetryAfter(input.retryAfter, input.nowMs);
	if (fromHeader !== void 0) return {
		retryAtMs: fromHeader,
		retrySource: "retry-after"
	};
	const fromBody = input.body === void 0 ? void 0 : parseUpstreamResetAt(input.body);
	if (fromBody !== void 0) return {
		retryAtMs: fromBody,
		retrySource: "upstream-message"
	};
	if (input.outcome === "out-of-credit" && input.quotaRefreshAtMs !== void 0) return {
		retryAtMs: input.quotaRefreshAtMs,
		retrySource: "quota-refresh"
	};
	return {};
}
/**
* Classify one failed probe into the card's outcome vocabulary.
*
* Built on `classifyUpstreamError` rather than re-testing status codes, so a
* probe and a real chat request can never disagree about what the same upstream
* answer means. The extra splits here are `credential-rejected`, which the
* upstream signals with a non-JSON 401/403 edge page and which needs completely
* different advice (re-auth, not "wait"), and `policy-rejected`, a JSON 403
* content-policy refusal where re-auth advice would be actively misleading.
*/
function outcomeOfFailure(status, body) {
	if (status === 401 || status === 403) {
		if (classifyUpstreamError(status, body) === "policy_reject") return "policy-rejected";
		return "credential-rejected";
	}
	switch (classifyUpstreamError(status, body)) {
		case "soft_rate": return "rate-limited";
		case "hard_credit": return "out-of-credit";
		case "session_dead": return "credential-rejected";
		case "not_found": return "not-found";
		default: return status === 0 || status >= 500 ? "unavailable" : "failed";
	}
}
/**
* Read the credit this probe consumed out of an SSE stream, when the upstream
* reports it.
*
* Purely informational — the card shows it so a user can see how little a probe
* actually costs rather than having to trust a claim. Absent when the stream
* carried no `usage` block.
*/
function creditOfStream(text) {
	const match = /"credit"\s*:\s*(-?[0-9]*\.?[0-9]+)/u.exec(text);
	if (match === null) return void 0;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : void 0;
}
/** Whether a probe outcome means the model answered. */
function probeSucceeded(outcome) {
	return outcome === "ok";
}
/** Max characters of upstream text kept for display, after redaction. */
const PROBE_MESSAGE_LIMIT = 300;
/**
* Redact token-shaped content out of upstream text before it is stored or sent.
*
* Lives here rather than in the route layer because this module is the one that
* reads raw failure bodies, so the redaction belongs at the point of capture. A
* probe failure body is the one place a raw upstream string from an arbitrary
* endpoint enters the plugin's data flow.
*
* EXPORTED because a failed CHAT request now persists its reason into the pool
* store too (`recordAccountFailure` in `src/index.ts`), and that text is a raw
* upstream body as well. One implementation, so the two writers cannot drift
* into redacting differently — the same "one definition" rule this codebase
* applies to `effectiveMembersOf`.
*/
function redactUpstreamText(text) {
	return text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]").slice(0, PROBE_MESSAGE_LIMIT);
}
/**
* Run one probe for one model and reduce it to the card's row.
*
* The successful path drains the SSE stream purely to read the `credit` figure
* the upstream reports, then discards the rest: the question is whether this
* model answers a real-sized request, and `max_tokens: 1` means there is nothing
* else in the stream worth keeping.
*
* Never throws. A probe is a diagnostic the user asked for, so every failure is
* a RESULT — one dead model must not abort the batch and hide the other rows.
*/
async function probeModel(input) {
	let answer;
	const startedAt = Date.now();
	try {
		answer = await input.client.probeChat(input.credential, probeRequestBody(input.modelId, input.inputTokens), input.signal);
	} catch (error) {
		return {
			modelId: input.modelId,
			outcome: "unavailable",
			message: redactUpstreamText(error instanceof Error ? error.message : String(error))
		};
	}
	const elapsedMs = Date.now() - startedAt;
	if (answer.ok) {
		let credit;
		if (answer.response !== void 0) try {
			credit = creditOfStream(await answer.response.text());
		} catch {}
		return {
			modelId: input.modelId,
			outcome: "ok",
			elapsedMs: Date.now() - startedAt,
			status: answer.status,
			...credit === void 0 ? {} : { message: `credit ${credit}` },
			...cooldownOf({
				outcome: "ok",
				retryAfter: answer.retryAfter,
				nowMs: input.nowMs,
				...input.quotaRefreshAtMs === void 0 ? {} : { quotaRefreshAtMs: input.quotaRefreshAtMs }
			})
		};
	}
	const body = answer.body ?? "";
	const outcome = outcomeOfFailure(answer.status, body);
	return {
		modelId: input.modelId,
		outcome,
		elapsedMs,
		status: answer.status,
		...body === "" ? {} : { message: redactUpstreamText(body) },
		...cooldownOf({
			outcome,
			retryAfter: answer.retryAfter,
			nowMs: input.nowMs,
			body,
			...input.quotaRefreshAtMs === void 0 ? {} : { quotaRefreshAtMs: input.quotaRefreshAtMs }
		})
	};
}
/**
* Check in every account, one at a time.
*
* Idempotent by design (see the module note): an account already checked in
* today is reported as `already` and NO write is attempted. A failure on one
* account is recorded on that row and the batch continues.
*
* Never throws: every problem becomes a row, because a batch that aborted on
* its first bad account would hide the state of all the others.
*/
async function checkinAllAccounts(targets, deps, nowMs = Date.now) {
	const rows = [];
	for (const [index, target] of targets.entries()) {
		if (index > 0) await (deps.wait ?? defaultWait)(400);
		rows.push(await checkinOne(target, deps));
	}
	return rows;
}
/** One account's check-in, reduced to its row. */
async function checkinOne(target, deps) {
	const base = {
		accountId: target.accountId,
		accountName: target.accountName
	};
	let credential;
	try {
		credential = await deps.credentialFor(target.accountId);
	} catch (error) {
		return {
			...base,
			status: "failed",
			message: messageOf(error)
		};
	}
	if (credential === void 0) return {
		...base,
		status: "failed",
		message: "no stored credential for this account"
	};
	try {
		const status = await deps.fetchCheckinStatus(credential);
		if (!status.active) return {
			...base,
			status: "failed",
			message: "check-in activity is not active"
		};
		if (status.todayCheckedIn) return {
			...base,
			status: "already"
		};
		const claim = await deps.claimDailyCheckin(credential);
		return {
			...base,
			status: "claimed",
			credit: claim.credit,
			streakDays: claim.streakDays
		};
	} catch (error) {
		return {
			...base,
			status: "failed",
			message: messageOf(error)
		};
	}
}
/**
* Test every account against one model, one at a time.
*
* The model is resolved by the caller (see `resolveTargetModel`) so this
* function never has to decide "free or not" — an unresolvable target is the
* caller's problem to report, and testing against a model nobody chose would be
* exactly the silent spend the plan forbids.
*
* Never throws: a failed probe is a ROW, not an aborted batch.
*
* `onRow` fires the moment one account's row exists, which is what lets a caller
* report progress. The loop is SERIAL by design (one account at a time — hitting
* the whole pool at once is the fastest way to trip the upstream's volume limit),
* so without this a caller cannot say anything until the SLOWEST member answers:
* one stuck account made a working batch look like a dead button. The return
* value is unchanged, so every existing caller keeps all rows at the end.
*/
async function testAllAccounts(targets, modelId, deps, onRow) {
	const rows = [];
	for (const [index, target] of targets.entries()) {
		if (index > 0) await (deps.wait ?? defaultWait)(400);
		const row = await testOne(target, modelId, deps);
		rows.push(row);
		onRow?.(row);
	}
	return rows;
}
/** One account's probe, reduced to its row. */
async function testOne(target, modelId, deps) {
	const base = {
		accountId: target.accountId,
		accountName: target.accountName
	};
	let credential;
	try {
		credential = await deps.credentialFor(target.accountId);
	} catch (error) {
		return {
			...base,
			result: {
				modelId,
				outcome: "credential-rejected",
				message: messageOf(error)
			}
		};
	}
	if (credential === void 0) return {
		...base,
		result: {
			modelId,
			outcome: "credential-rejected",
			message: "no stored credential for this account"
		}
	};
	return {
		...base,
		result: await deps.probe(credential, modelId)
	};
}
/**
* Turn a test batch's rows into the per-account measurements to remember.
*
* A row is stored only when the probe actually measured the MODEL. A row that
* failed because the credential could not even be read says nothing about the
* model, and recording it would exclude a possibly-perfect account from the
* pool — so those accounts keep their previous measurement instead.
*
* `atMs` is stamped here, once for the batch, so the card's "tested N minutes
* ago" reflects when the batch finished rather than drifting per row.
*
* `message` is carried through as well. `probeModel` already redacted it before
* returning, so persisting it cannot leak a token, and without it the pool table
* could only repeat one generic sentence for a DNS failure, a gateway 502 and a
* cancelled request alike.
*/
function probeUpdatesOf(rows) {
	const atMs = Date.now();
	const updates = {};
	for (const row of rows) {
		if (isTransportFailure(row.result)) continue;
		updates[row.accountId] = {
			outcome: row.result.outcome,
			atMs,
			source: "test-batch",
			...row.result.retryAtMs === void 0 ? {} : { retryAtMs: row.result.retryAtMs },
			...row.result.message === void 0 ? {} : { message: row.result.message }
		};
	}
	return updates;
}
/**
* Whether a probe result measures the transport rather than the model.
*
* `credential-rejected` with the pool's own "no stored credential" message is
* the one case we can attribute to ourselves rather than the upstream: the
* request never left. Every other rejection came from the upstream and IS a
* statement about this account, so it is kept.
*/
function isTransportFailure(result) {
	return result.outcome === "credential-rejected" && result.message?.startsWith("no stored credential") === true;
}
/** The default inter-account pause. */
function defaultWait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
/** A safe message from an unknown throwable, bounded in length. */
function messageOf(error) {
	return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
/**
* Whether one account can be billed at `nowMs`.
*
* Returns the exclusion reason, or undefined when the account is a candidate.
* The order matters and is NOT arbitrary:
*
* - A `credential-rejected` account is excluded regardless of any cooldown: its
*   token is not accepted, so waiting cannot help and the user must re-auth.
* - A limited, unreachable or failed outcome is checked against its stated (or
*   fallback) cooldown, so an account whose limit has already reset — or whose
*   gateway blipped once — is back in the pool without needing another test
*   first.
* - An `ok` measurement, and no measurement at all, are both candidates. The
*   latter matters: a freshly discovered account has never been tested and must
*   not be invisible.
*
* WHY TRANSIENT OUTCOMES GET A COOLDOWN. They are not statements about the
* ACCOUNT. A transport failure can be a DNS blip, and — before the shim learned
* to skip reporting an aborted request — it was routinely the user closing the
* panel mid-flight. A 5xx is the gateway's afternoon, not this account's health.
* Excluding them permanently meant one transient event idled a perfectly good
* account until the user happened to press "test" again, and with every member
* so idled the pool had no candidate at all: failover then had nowhere to go and
* the raw upstream error was reported as-is. The cooldown is what makes the pool
* RECOVER instead of staying broken.
*
* `not-found` and `credential-rejected` deliberately get none: one describes a
* model the region no longer offers (a catalog fact, not a transient one) and
* the other needs the user to sign in again. Neither is fixed by waiting, and
* pretending otherwise would re-bill a token the upstream has already refused.
*
* Each unusable outcome keeps its OWN value rather than being folded into
* `credential-rejected`. The fold made one row state two contradictory things —
* the name column said "被拒绝" (sign in again) while the probe column, reading
* the same measurement, said "连不上上游——这是网络问题，不是模型问题" — and it
* told a user whose upstream had merely blipped that their sign-in was bad.
* (That label has since been made cause-NEUTRAL: it used to assert "not the
* model" for a bucket that also holds gateway 5xx and request timeouts, where
* the claim is simply unfounded. The recorded `message` now carries the cause.)
* The distinctions are already computed upstream in `outcomeOfFailure`
* (`src/probe.ts:290-299`); this only stops discarding them.
*/
function exclusionOf(probe, nowMs) {
	if (probe === void 0) return void 0;
	switch (probe.outcome) {
		case "ok": return;
		case "credential-rejected": return "credential-rejected";
		case "not-found": return "not-found";
		case "unavailable": return retryDue(probe, nowMs) ? void 0 : "unavailable";
		case "failed": return retryDue(probe, nowMs) ? void 0 : "failed";
		case "rate-limited": return retryDue(probe, nowMs) ? void 0 : "rate-limited";
		case "out-of-credit": return retryDue(probe, nowMs) ? void 0 : "out-of-credit";
		case "policy-rejected": return;
		default: return "unusable";
	}
}
/**
* Whether an account's cooldown has elapsed (or was never stated).
*
* The fallback is the ONLY thing a transient outcome relies on: `cooldownOf`
* attaches `retryAtMs` for a rate limit or a drained quota, never for a
* transport failure, so `atMs + POOL_UNKNOWN_COOLDOWN_MS` is what brings those
* back. That is deliberate — the alternative is a permanent exclusion decided by
* an event that said nothing about the account.
*/
function retryDue(probe, nowMs) {
	return nowMs >= (probe.retryAtMs ?? probe.atMs + 18e5);
}
/**
* Rank a pool's members best-first.
*
* The rule, in priority order — this is the whole feature:
*
* 1. **Usability.** Only accounts that can be billed right now are candidates;
*    they always outrank every excluded one.
* 2. **Credits, highest first.** Spend the account that has the most, so an
*    account running low is conserved rather than drained first.
* 3. **Credits expiring soonest first.** Points about to expire are worth
*    exactly zero after they do, so using them earlier is strictly better than
*    saving them.
* 4. **Freshest credential.** Tie-break so a stale token never wins a draw.
* 5. **Account id.** Final tie-break, making the order TOTAL: two accounts
*    equal on every ranking key would otherwise keep the caller's array order,
*    so the same pool could rotate differently between two runs.
*
* Excluded accounts are still RETURNED (sorted after the candidates) so the
* card can explain why each is out; they differ from candidates by
* `excludedBy` being set on them, never by being silently dropped.
*
* Pure and total: the same input always yields the same order, and it never
* throws on missing data (an account with no credits is ranked as 0, not
* crashed on).
*/
function rankPool(members, nowMs) {
	const rows = members.map((member) => {
		const excludedBy = exclusionOf(member.probe, nowMs);
		return {
			account: member.account,
			score: scoreOf(member),
			...excludedBy === void 0 ? {} : { excludedBy },
			_usable: excludedBy === void 0,
			_expiring: member.credits?.nearestExpiryMs ?? Number.POSITIVE_INFINITY,
			_tokenExpiresAtMs: member.tokenExpiresAtMs ?? 0
		};
	});
	rows.sort((left, right) => {
		if (left._usable !== right._usable) return left._usable ? -1 : 1;
		if (left.score !== right.score) return right.score - left.score;
		if (left._expiring !== right._expiring) return left._expiring - right._expiring;
		if (left._tokenExpiresAtMs !== right._tokenExpiresAtMs) return right._tokenExpiresAtMs - left._tokenExpiresAtMs;
		return left.account.id < right.account.id ? -1 : left.account.id > right.account.id ? 1 : 0;
	});
	return rows.map(({ account, score, excludedBy }) => ({
		account,
		score,
		...excludedBy === void 0 ? {} : { excludedBy }
	}));
}
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
* The credit figure used for ordering.
*
* Absent credits rank as zero. Deliberately NOT "unknown ranks first": an
* account whose balance could not be read must never outrank one we positively
* know is full, or a failing credits route would capture all the traffic.
*/
function scoreOf(member) {
	return member.credits?.total ?? 0;
}
/**
* Pick the free model to test against, from one region's catalog.
*
* "Free" means `creditMultiplier === 0` EXACTLY. An absent multiplier is NOT
* free — see the module note: the CN static fallback carries no multiplier at
* all, so treating absence as zero would silently bill real credits.
*
* Among the free candidates the LARGEST context window wins, because the probe
* sends a real-sized payload (25k input) and a long-conversation probe is the
* point: a small-window model would either reject it or answer a question the
* user never asked.
*
* Returns undefined when the region has no free model, which the caller must
* render as "none available" — never as a fallback to a paid model.
*/
function pickFreeModel(catalog) {
	let best;
	for (const model of catalog) {
		if (model.creditMultiplier !== 0) continue;
		if (best === void 0 || model.contextWindow > best.contextWindow) best = model;
	}
	return best;
}
/**
* Resolve the model the pool should test against.
*
* A user-specified id always wins (it is a preference, not a computed default),
* and is returned even when it is a PAID model: the card says so explicitly
* rather than silently overriding the user's choice.
*
* But the choice is now VALIDATED against the region's catalog, because the
* catalog changes: the CN roster is empty until its first refresh, and models
* come and go. A saved id that is no longer offered used to be returned as
* `preferred`, which let the card enable its test button and the Host run a
* batch against a model nobody offers. It is reported as `stale` instead —
* never silently replaced by the free model (that would test something the
* user did not choose) and never run.
*
* A catalog that has not loaded yet therefore reads as `stale` for a saved id.
* That is the safe direction: no credits are spent while the roster is unknown,
* and the card offers to switch back to automatic.
*/
function resolveTargetModel(catalog, preferredId) {
	if (preferredId !== void 0 && preferredId !== "") return catalog.some((model) => model.id === preferredId) ? {
		modelId: preferredId,
		source: "preferred"
	} : {
		staleModelId: preferredId,
		source: "stale"
	};
	const free = pickFreeModel(catalog);
	return free === void 0 ? { source: "none" } : {
		modelId: free.id,
		source: "free"
	};
}
//#endregion
//#region src/account-pool-store.ts
/**
* The account pool's RUNTIME store: measured facts, on disk, outside settings.
*
* 参考：本仓库 `src/auth.ts` 的插件自有文件约定（`$DSH_HOME` 下的
*   `.workbuddy-auth.<region>.json`，`withFileLock` + `writeFileAtomic`，
*   `mode: 0o600`）。本模块沿用同一套写入方式与同一份隐私标准。
* 改动：存的是**观测结果**而非凭据 —— 因此文件里不含任何 token，
*   并且它与用户设置**分开落盘**，原因见下。
*
* 为什么这些事实不放 settings（`regions[region].pool`）：
*
*   卡片对用户偏好用的是「草稿 → 保存 → 丢弃草稿」模式：保存成功会丢弃草稿。
*   如果探测结果也住在那个槽里，用户手工点一次「保存」就会用**几分钟前的草稿**
*   覆盖掉定时器刚写进去的结果 —— 那等于把测量结果回退，测试白做。
*   观测数据由插件高频写入、且不是用户偏好，所以它必须落在自己的文件里。
*
* 本模块的读写**从不抛异常给调用方**：池是增强功能，一个损坏的观测文件绝不能让
* 卡片或 host 启动失败 —— 最坏情况是「回到未测试」，而不是整个插件不可用。
*
* @module dsh-connect-workbuddy/account-pool-store
*/
/** On-disk format version; readers reject anything else. */
const STORE_FORMAT_VERSION = 1;
/** Filename prefix for one region's measured pool facts. */
const POOL_STORE_PREFIX = ".workbuddy-pool";
/** Whether a parsed value looks like a stored probe. */
function isProbe(value) {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value;
	return typeof candidate["outcome"] === "string" && typeof candidate["atMs"] === "number" && (candidate["retryAtMs"] === void 0 || typeof candidate["retryAtMs"] === "number") && (candidate["message"] === void 0 || typeof candidate["message"] === "string") && (candidate["source"] === void 0 || typeof candidate["source"] === "string");
}
/**
* One region's path for measured pool facts.
*
* Region-keyed for the same reason the credential copies are: the two regions
* are parallel stacks and must never overwrite each other's measurements.
*/
function workbuddyPoolStorePath(region) {
	return join(resolveDshHome(), `${POOL_STORE_PREFIX}.${region}.json`);
}
/**
* Read one region's measured facts.
*
* Contains NO credentials. The one free-text field is `message`, and it is
* REDACTED BY THE WRITER before it ever reaches this file (`probe.ts`'s
* `redactUpstreamText`), so a token-shaped string cannot survive into storage.
* Because of that the file is not written with the credential store's stricter
* secrecy requirements, though it still uses the same atomic-write helpers.
*
* Returns an empty map for a missing, unreadable, malformed, or
* version-mismatched file: all four mean "nothing measured yet", which is a
* valid state the pool renders as "untested".
*/
async function readPoolProbes(region) {
	let raw;
	try {
		raw = await readFile(workbuddyPoolStorePath(region), "utf8");
	} catch {
		return {};
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null) return {};
	const document = parsed;
	if (document.version !== STORE_FORMAT_VERSION) return {};
	if (typeof document.probes !== "object" || document.probes === null) return {};
	const probes = {};
	for (const [accountId, probe] of Object.entries(document.probes)) {
		if (accountId === "" || !isProbe(probe)) continue;
		probes[accountId] = {
			outcome: probe.outcome,
			atMs: probe.atMs,
			...knownProbeSource(probe.source) === void 0 ? {} : { source: knownProbeSource(probe.source) },
			...probe.retryAtMs === void 0 ? {} : { retryAtMs: probe.retryAtMs },
			...probe.message === void 0 ? {} : { message: probe.message }
		};
	}
	return probes;
}
/**
* A stored source string reduced to a source this build understands.
*
* `isProbe` accepts any string so a newer build's label cannot destroy the
* measurement it describes; this narrows it at the point of use. An unknown
* value becomes `undefined`, which the card renders as "unknown" — the honest
* answer, rather than mislabelling it as one of the two kinds we do know.
*/
function knownProbeSource(value) {
	return value === "test-batch" || value === "live-request" ? value : void 0;
}
/**
* Merge measurements into one region's store and write it atomically.
*
* A MERGE rather than a replace, because batches measure one account at a time
* and a partial failure must not erase what earlier runs learned. An account
* absent from `updates` keeps its previous measurement.
*
* Never throws: a failed write loses only the newest measurements, and the
* caller's results are still returned to the user. Surfacing a disk error here
* would fail an operation that actually succeeded.
*/
async function writePoolProbes(region, updates) {
	if (Object.keys(updates).length === 0) return;
	const path = workbuddyPoolStorePath(region);
	try {
		await withFileLock(path, async () => {
			const existing = await readPoolProbes(region);
			const document = {
				version: STORE_FORMAT_VERSION,
				probes: {
					...existing,
					...updates
				}
			};
			await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`, {
				mode: 384,
				dirMode: 448
			});
		});
	} catch {}
}
//#endregion
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
/** Plugin-owned live model refresh endpoint. */
const WORKBUDDY_MODELS_REFRESH_PATH = "/plugins/dsh-connect-workbuddy/models/refresh";
/** Plugin-owned local account rescan endpoint. */
const WORKBUDDY_ACCOUNTS_REFRESH_PATH = "/plugins/dsh-connect-workbuddy/accounts/refresh";
/** Plugin-owned daily check-in action endpoint. */
const WORKBUDDY_CHECKIN_PATH = "/plugins/dsh-connect-workbuddy/checkin";
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
/** Read the pool action off a request URL; unknown/absent means undefined. */
function poolActionOf(url) {
	const at = url.indexOf("?");
	if (at === -1) return void 0;
	const value = new URLSearchParams(url.slice(at + 1)).get(WORKBUDDY_POOL_ACTION_PARAM);
	return value === "checkin" || value === "test" ? value : void 0;
}
/** Query parameter naming the region a card request addresses. */
const WORKBUDDY_REGION_PARAM = "region";
/** Every region, in card tab order. */
const WORKBUDDY_REGIONS = ["cn"];
/**
* Address one region's status route. The two regions are separate provider
* stacks; every card request carries the region whose tab the user is on.
*/
function withWorkBuddyRegion(path, region) {
	return `${path}?${WORKBUDDY_REGION_PARAM}=${region}`;
}
/**
* Read the region parameter off a status-route URL. Absent means the domestic
* tab (`cn`); a present-but-unknown value returns undefined so the route can
* answer 400 instead of guessing.
*/
function regionOfStatusUrl(url) {
	const at = url.indexOf("?");
	const value = at === -1 ? null : new URLSearchParams(url.slice(at + 1)).get(WORKBUDDY_REGION_PARAM);
	if (value === null || value === "") return "cn";
	return WORKBUDDY_REGIONS.includes(value) ? value : void 0;
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
//#region src/web-status.ts
/** Redact token-like content before it crosses to the browser. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]").slice(0, 500);
}
/** A non-null, non-array object: the only shape the slot merge applies to. */
function isPlainRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function json(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
/** Request-body cap for the probe route: model ids only, never content. */
const PROBE_BODY_LIMIT = 65536;
/**
* Read a small JSON request body.
*
* Bounded, unlike the settings route's reader: this endpoint takes a list of
* model ids and has no legitimate use for a large payload, so an oversized body
* is refused rather than buffered.
*/
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > PROBE_BODY_LIMIT) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
					reject(/* @__PURE__ */ new Error("request body must be a JSON object"));
					return;
				}
				resolve(parsed);
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
		req.on("error", reject);
	});
}
/** Loopback browser origins only; other devices are refused until trusted origins exist. */
function loopbackOrigin(req) {
	const origin = req.headers.origin;
	if (origin === void 0) return true;
	try {
		const { hostname } = new URL(origin);
		return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
	} catch {
		return false;
	}
}
/** Map the credit answer to the card's compact document. */
function toCredits(answer) {
	return {
		total: answer.total,
		packages: answer.packages.map((pack) => ({
			packageName: pack.packageName,
			remain: pack.remain,
			size: pack.size,
			monthly: pack.monthly,
			...pack.refreshAtMs === void 0 ? {} : { cycleRefreshMs: pack.refreshAtMs },
			...pack.expiresAtMs === void 0 ? {} : { expiresAtMs: pack.expiresAtMs }
		})),
		expiringSoon: answer.expiringSoon,
		...answer.nearestExpiryMs === void 0 ? {} : { nearestExpiryMs: answer.nearestExpiryMs }
	};
}
/** Project a model into the card's row, dropping empty optional fields. */
function toWebModel(model, budgets) {
	const budgeted = applyContextBudgets([model], budgets)[0] ?? model;
	return {
		id: model.id,
		name: model.name,
		contextWindow: budgeted.contextWindow,
		nativeContextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		...model.creditMultiplier === void 0 ? {} : { creditMultiplier: model.creditMultiplier },
		...model.supportsImages === void 0 ? {} : { supportsImages: model.supportsImages },
		...model.multimodal === void 0 ? {} : { multimodal: model.multimodal },
		...model.reasoning === void 0 ? {} : { reasoning: {
			...model.reasoning.supportedEfforts === void 0 ? {} : { supportedEfforts: [...model.reasoning.supportedEfforts] },
			...model.reasoning.defaultEffort === void 0 ? {} : { defaultEffort: model.reasoning.defaultEffort },
			...model.reasoning.canDisableThinking === void 0 ? {} : { canDisableThinking: model.reasoning.canDisableThinking }
		} }
	};
}
/**
* Project a store account into the card's token-free account row.
*
* `uin` is deliberately NOT forwarded: the card has never rendered it, so
* sending it was pure exposure of an account identifier for no feature. The
* name carries whatever the desktop app recorded, and `''` means the card
* should show its own placeholder rather than an identifier.
*/
function toWebAccount(account) {
	return {
		id: account.id,
		accountName: account.accountName,
		domain: account.domain,
		source: account.source,
		tokenExpiresAtMs: account.tokenExpiresAtMs,
		selected: account.selected
	};
}
/**
* The probed-path list for a signed-out region, or nothing when the store
* cannot produce one.
*
* Diagnostics must never turn a page into an error: `diagnose()` re-reads the
* filesystem, and a store built without it (or one whose probe throws on an
* exotic filesystem) degrades to the plain "not signed in" hint the card showed
* before this existed. Failure reasons are `safeMessage`d because a raw
* filesystem error can embed an absolute path or a fragment of file content.
*/
async function searchedPaths(store) {
	if (typeof store.diagnose !== "function") return {};
	try {
		const { failures } = await store.diagnose();
		if (failures.length === 0) return {};
		return { searched: failures.map((failure) => ({
			path: failure.path,
			source: failure.source,
			reason: failure.reason,
			...failure.message === void 0 ? {} : { message: safeMessage(failure.message) }
		})) };
	} catch {
		return {};
	}
}
/** Reads schemastery's internal `meta.volatile` marker for one top-level field. */
function volatileFlagOf(field) {
	return Config.dict?.[field]?.meta?.volatile === true;
}
/**
* Assemble one region's card document. `region` is the tab the card is on;
* the region-scoped store already answers with only that region's accounts,
* so the document's model slots and account list are that region's by
* construction. Sign-in state is read-only; credit is a live billing answer
* whose failure degrades to `creditsError` rather than failing the document.
*/
async function workBuddyWebStatus(deps, region) {
	const store = deps.store(region);
	const accounts = await store.accounts();
	deps.regionUsable?.(region, accounts.length > 0);
	const enabled = deps.regionEnabled(region);
	const authStatus = await store.status();
	const selectionExplicit = store.hasExplicitSelection();
	if (authStatus.state !== "signed-out" && accounts.length === 0) return {
		status: "signed-out",
		accounts: [],
		selectionExplicit,
		enabled
	};
	let credential;
	try {
		credential = await store.resolve();
	} catch (error) {
		const webAccounts = accounts.map(toWebAccount);
		return {
			status: "signed-out",
			accounts: webAccounts,
			message: safeMessage(error),
			selectionExplicit,
			enabled,
			...await store.selectionLost() ? { selectionLost: true } : {},
			...webAccounts.length === 0 ? await searchedPaths(store) : {}
		};
	}
	const selected = accounts.find((account) => account.selected);
	const account = {
		accountId: selected?.id ?? "",
		accountName: credential.nickname ?? "",
		...credential.domain === "" ? {} : { domain: credential.domain },
		region,
		source: credential.source,
		tokenExpiresAtMs: credential.expiresAtMs,
		selectionExplicit,
		enabled,
		accounts: accounts.map(toWebAccount),
		models: deps.displayModels(region).map((model) => toWebModel(model, deps.contextBudgets(region))),
		enabledModelIds: [...deps.enabledModelIds(region)],
		imageModelIds: [...deps.imageModelIds(region)],
		offModelIds: [...deps.offModelIds(region)]
	};
	const [creditsResult, checkinResult] = await Promise.allSettled([deps.client.fetchCredits(credential), deps.client.fetchCheckinStatus(credential)]);
	const rejected = [creditsResult, checkinResult].some((result) => result.status === "rejected" && isCredentialRejectedError(result.reason));
	const recovery = !rejected ? void 0 : await resolveCredentialRecovery({
		region,
		store: deps.store(region),
		...selected === void 0 ? {} : { rejectedAccountId: selected.id },
		probe: deps.accountUsable ?? (async () => false)
	});
	return {
		status: "signed-in",
		contextBudgets: Object.fromEntries(Object.entries(deps.contextBudgets(region)).filter(([, value]) => typeof value === "number")),
		diagVolatile: {
			regions: volatileFlagOf("regions"),
			accounts: volatileFlagOf("accounts"),
			authFile: volatileFlagOf("authFile")
		},
		...account,
		...creditsResult.status === "fulfilled" ? { credits: toCredits(creditsResult.value) } : { creditsError: safeMessage(creditsResult.reason) },
		...checkinResult.status === "fulfilled" ? { checkin: checkinResult.value } : { checkinError: safeMessage(checkinResult.reason) },
		...!rejected ? {} : { credentialRejected: true },
		...recovery === void 0 ? {} : { recovery },
		...await poolSectionOf(deps, region)
	};
}
/** The pool block for a status document, or nothing when it cannot be built. */
async function poolSectionOf(deps, region) {
	if (deps.pool === void 0) return {};
	try {
		const pool = await workBuddyWebPool(deps, region);
		return pool === void 0 ? {} : { pool };
	} catch {
		return {};
	}
}
/**
* Assemble one region's pool state for the card.
*
* The ranking is computed HERE, on the Host, and shipped as an ordered,
* annotated list. The card therefore never re-derives "who is eligible" — it
* renders the Host's answer, so the account the user sees marked as current is
* decided by the same rule that would actually bill.
*
* `current` is answered by the Host too (`currentAccountId`), not inferred from
* the ranking, because those are different questions: the ranking says who
* SHOULD serve, `current` says who IS serving. Marking the winner as current
* would make the card claim a switch that may not have been applied yet.
*/
async function workBuddyWebPool(deps, region) {
	const pool = deps.pool;
	if (pool === void 0) return void 0;
	const preferences = pool.preferences(region);
	const members = await pool.members(region);
	const ranked = rankPool(members, Date.now());
	const target = resolveTargetModel(pool.catalog?.(region) ?? [], preferences.targetModelId);
	const currentAccountId = await pool.currentAccountId?.(region);
	const byId = new Map(members.map((member) => [member.account.id, member]));
	const rankedIds = new Set(ranked.map((row) => row.account.id));
	const others = await pool.otherAccounts?.(region) ?? [];
	const checkedIn = await pool.checkedInToday?.(region).catch(() => ({})) ?? {};
	const accounts = [...ranked.map((row) => ({
		account: row.account,
		member: true,
		ranked: row
	})), ...others.filter((account) => !rankedIds.has(account.id)).map((account) => ({
		account,
		member: false
	}))].map(({ account, member, ranked: row }) => {
		const measured = byId.get(account.id);
		return {
			accountId: account.id,
			accountName: account.accountName,
			...measured?.credits === void 0 ? {} : {
				credits: measured.credits.total,
				expiringSoon: measured.credits.expiringSoon,
				...measured.credits.nearestExpiryMs === void 0 ? {} : { nearestExpiryMs: measured.credits.nearestExpiryMs }
			},
			...measured?.probe === void 0 ? {} : { probe: {
				outcome: measured.probe.outcome,
				atMs: measured.probe.atMs,
				...measured.probe.source === void 0 ? {} : { source: measured.probe.source },
				...measured.probe.retryAtMs === void 0 ? {} : { retryAtMs: measured.probe.retryAtMs },
				...measured.probe.message === void 0 ? {} : { message: measured.probe.message }
			} },
			...row?.excludedBy === void 0 ? {} : { excludedBy: row.excludedBy },
			current: account.id === currentAccountId,
			member,
			...checkedIn[account.id] === void 0 ? {} : { checkedInToday: checkedIn[account.id] }
		};
	});
	return {
		enabled: preferences.enabled,
		checkinSupported: pool.checkinSupported?.(region) === true,
		...target.modelId === void 0 ? {} : { targetModelId: target.modelId },
		...target.staleModelId === void 0 ? {} : { staleTargetModelId: target.staleModelId },
		targetModelSource: target.source,
		memberAccountIds: preferences.memberAccountIds,
		...preferences.probeInputTokens === void 0 ? {} : { probeInputTokens: preferences.probeInputTokens },
		effectiveMemberAccountIds: effectiveMembersOf(accounts.map((account) => account.accountId), new Set(preferences.memberAccountIds)),
		accounts,
		catalog: deps.displayModels(region).map((model) => ({
			id: model.id,
			name: model.name,
			...model.creditMultiplier === void 0 ? {} : { creditMultiplier: model.creditMultiplier }
		}))
	};
}
/**
* The region a request addresses, or a 400 answer. Absent parameter means the
* domestic tab; an unknown value is refused rather than guessed.
*/
function requestRegion(req, res) {
	const region = regionOfStatusUrl(req.url ?? "/");
	if (region === void 0) {
		json(res, 400, { error: "unknown region" });
		return;
	}
	return region;
}
/**
* Mount the read-only routes on a context where `webServer` is available.
* The caller uses `ctx.inject(['webServer'], ...)`, so Desktop startup order
* cannot make this registration disappear.
*/
function registerWorkBuddyStatusRoute(ctx, deps) {
	ctx.effect(() => {
		const disposeUsage = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_USAGE_PATH,
			handler: async (req, res) => {
				if (req.method !== "GET") {
					json(res, 405, { error: "method not allowed" });
					return;
				}
				if (!loopbackOrigin(req)) {
					json(res, 403, { error: "origin-not-trusted" });
					return;
				}
				const region = requestRegion(req, res);
				if (region === void 0) return;
				try {
					json(res, 200, await workBuddyWebStatus(deps, region));
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeAccounts = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_ACCOUNTS_REFRESH_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				const region = requestRegion(req, res);
				if (region === void 0) return;
				try {
					const accounts = await deps.store(region).accounts();
					deps.regionUsable?.(region, accounts.length > 0);
					json(res, 200, { accounts: accounts.map(toWebAccount) });
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeCheckin = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_CHECKIN_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				const region = requestRegion(req, res);
				if (region === void 0) return;
				try {
					const credential = await deps.store(region).resolve();
					const current = await deps.client.fetchCheckinStatus(credential);
					if (!current.active) return json(res, 409, { error: "check-in activity is not active" });
					if (current.todayCheckedIn) return json(res, 200, {
						alreadyCheckedIn: true,
						checkin: current
					});
					json(res, 200, {
						alreadyCheckedIn: false,
						claim: await deps.client.claimDailyCheckin(credential),
						checkin: await deps.client.fetchCheckinStatus(credential)
					});
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeRefresh = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_MODELS_REFRESH_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				if (deps.discoverModels === void 0) return json(res, 503, { error: "model refresh unavailable" });
				const region = requestRegion(req, res);
				if (region === void 0) return;
				try {
					json(res, 200, { models: (await deps.discoverModels(region)).map((model) => toWebModel(model, deps.contextBudgets(region))) });
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeProbe = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_PROBE_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				if (deps.probeModels === void 0) return json(res, 503, { error: "model probe unavailable" });
				const region = requestRegion(req, res);
				if (region === void 0) return;
				try {
					const body = await readJsonBody(req);
					const modelIds = Array.isArray(body.modelIds) ? body.modelIds.filter((id) => typeof id === "string" && id !== "") : [];
					if (modelIds.length === 0) return json(res, 400, { error: "modelIds must be a non-empty array of strings" });
					if (modelIds.length > 1) return json(res, 400, { error: "a probe accepts exactly one model" });
					const results = [];
					for (const modelId of modelIds) results.push(...await deps.probeModels(region, [modelId]));
					json(res, 200, { results });
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposePool = ctx.webServer.register({
			kind: "exact",
			path: WORKBUDDY_POOL_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				const region = requestRegion(req, res);
				if (region === void 0) return;
				const action = poolActionOf(req.url ?? "/");
				if (action === void 0) return json(res, 400, { error: "action must be checkin or test" });
				const pool = deps.pool;
				if (pool === void 0) return json(res, 503, {
					reason: "pool-unavailable",
					error: "account pool unavailable"
				});
				try {
					const savedMembers = pool.preferences(region).memberAccountIds;
					if ((await pool.effectiveMemberAccountIds?.(region).catch(() => void 0) ?? savedMembers).length === 0) {
						const noneChecked = savedMembers.length === 0;
						return json(res, 409, {
							reason: noneChecked ? "no-members" : "no-live-members",
							error: noneChecked ? "no accounts are checked into this region's pool" : "no checked account still has a local sign-in"
						});
					}
					if (action === "checkin") {
						if (pool.checkinSupported?.(region) !== true) return json(res, 409, {
							reason: "checkin-unsupported",
							error: "this region does not offer a daily check-in"
						});
						if (pool.checkin === void 0) return json(res, 503, {
							reason: "pool-unavailable",
							error: "pool check-in unavailable"
						});
						return json(res, 200, {
							action: "checkin",
							rows: await pool.checkin(region)
						});
					}
					if (pool.test === void 0) return json(res, 503, {
						reason: "pool-unavailable",
						error: "pool test unavailable"
					});
					const target = resolveTargetModel(pool.catalog?.(region) ?? [], pool.preferences(region).targetModelId);
					if (target.modelId === void 0) return json(res, 409, {
						action: "test",
						modelId: void 0,
						rows: [],
						reason: target.source === "stale" ? "target-model-stale" : "no-free-model",
						error: target.source === "stale" ? "the saved target model is no longer offered by this region; pick another or switch back to automatic" : "no zero-multiplier model in this region; refresh the catalog or set a target model"
					});
					res.writeHead(200, {
						"Content-Type": "application/x-ndjson",
						"Cache-Control": "no-cache",
						"Connection": "keep-alive",
						"X-Accel-Buffering": "no"
					});
					const writeLine = (payload) => {
						res.write(`${JSON.stringify(payload)}\n`);
					};
					writeLine({
						action: "test",
						modelId: target.modelId
					});
					try {
						await pool.test(region, target.modelId, (row) => {
							writeLine({ row });
						});
						writeLine({ done: true });
					} catch (error) {
						writeLine({
							reason: "pool-failed",
							error: safeMessage(error)
						});
					}
					res.end();
					return;
				} catch (error) {
					json(res, 500, {
						reason: "pool-failed",
						error: safeMessage(error)
					});
				}
			}
		});
		const disposeDiagWrite = ctx.webServer.register({
			kind: "exact",
			path: "/plugins/dsh-connect-workbuddy/__save",
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				const settings = ctx.get?.("settings");
				if (settings === void 0) return json(res, 503, { error: "settings service unavailable to this fiber" });
				try {
					const body = await new Promise((resolve, reject) => {
						const chunks = [];
						req.on("data", (chunk) => chunks.push(chunk));
						req.on("end", () => {
							try {
								resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
							} catch (e) {
								reject(e);
							}
						});
						req.on("error", reject);
					});
					const field = body.field;
					if (field !== "regions" && field !== "accounts") return json(res, 400, { error: "field must be regions or accounts" });
					const row = settings.describe().find((r) => String(r.ns).includes("workbuddy"));
					if (row === void 0) return json(res, 503, { error: "workbuddy namespace missing from describe()" });
					const current = unwrapVolatileDeep(row.value?.[field] ?? {});
					const incoming = body.value ?? {};
					const merged = { ...current };
					for (const [key, slot] of Object.entries(incoming)) {
						const prior = current[key];
						merged[key] = isPlainRecord(prior) && isPlainRecord(slot) ? {
							...prior,
							...slot
						} : slot;
					}
					if (field === "regions") for (const key of Object.keys(incoming)) {
						const slot = merged[key];
						if (!isPlainRecord(slot) || key !== "cn" && key !== "global") continue;
						if (Array.isArray(slot.lastCatalog) && slot.lastCatalog.length > 0) continue;
						const live = deps.displayModels(key);
						if (live.length === 0) continue;
						slot.lastCatalog = live;
					}
					await settings.mutate(row.ns, [{
						op: "set",
						path: [field],
						value: merged
					}], void 0);
					return json(res, 200, {
						ok: true,
						value: merged
					});
				} catch (error) {
					const err = error;
					return json(res, 500, {
						ok: false,
						errorName: err?.name ?? "unknown",
						error: err?.message ?? String(error)
					});
				}
			}
		});
		return () => {
			disposeRefresh();
			disposeCheckin();
			disposeAccounts();
			disposeUsage();
			disposeProbe();
			disposePool();
			disposeDiagWrite();
		};
	}, "dsh-connect-workbuddy: Web status route");
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
//#region src/off-thinking.ts
/**
* Ids observed to REFUSE `reasoning_effort: "off"` with HTTP 400 despite
* declaring `canDisableThinking: true` (issue #34).
*
* Keyed by exact model id and deliberately NOT by region: `deepseek-v4.1-flash`
* refuses on BOTH gateways, and the split tracks the model family rather than
* the gateway. The cost is asymmetric — offering a level that always fails
* costs the user every request for that model, while hiding one that would have
* worked costs a single option — so the table errs towards hiding. A user who
* knows better can override any entry (see {@link effectiveOff}).
*
* `deepseek-v4-pro` was measured on the CN gateway only; it is listed because
* its sibling does refuse on both, and the same asymmetry argues for hiding.
*/
const REFUSES_OFF_MODEL_IDS = /* @__PURE__ */ new Set([
	"deepseek-v4.1-flash",
	"deepseek-v4.1-flash-sg",
	"deepseek-v4-pro",
	"primary-model",
	"gpt-6-astra",
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gemini-3.5-flash"
]);
/**
* Whether `off` should be offered for a model when the user has expressed no
* opinion: the upstream's declaration, minus the ids known to refuse it.
*
* Only an explicit `canDisableThinking: true` enables the level; absence is
* "unknown" and stays unoffered, matching how the rest of the plugin treats an
* undeclared capability.
*/
function offDefaultFor(info) {
	return info.reasoning?.canDisableThinking === true && !REFUSES_OFF_MODEL_IDS.has(info.id);
}
/**
* The model ids the `off` level should be offered for by default (issue #34).
*
* The user's checkbox is a plain set: ticked = offered, unticked = withdrawn.
* This is the seed — what the set is filled with the first time it is read —
* so a profile that has never saved shows the correct default immediately,
* without requiring a save.
*
* Only an explicit `canDisableThinking: true` enables the level; absence is
* "unknown" and stays unoffered, matching how the rest of the plugin treats an
* undeclared capability.
*/
function defaultOffModelIds(models) {
	return models.filter(offDefaultFor).map((model) => model.id);
}
/**
* Stamp the user's saved `off` selection onto a model list, for the RUNTIME
* catalog.
*
* The runtime model descriptor is built by `workBuddyThinkingLevelMap`, which
* reads only the model's own declaration — so the corrected answer has to be
* written onto the model before it reaches the adapter. Doing it here keeps the
* adapter a pure "declared capability in, level map out" function and keeps the
* table next to the rule it feeds.
*
* This OVERWRITES the declared field rather than adding a sibling, which is
* safe because the declared value has exactly one consumer (that same level
* map) and is never persisted where the card can see it: `toWebModel` drops
* `canDisableThinking`, and the card's `lastCatalog` is written from the raw
* upstream discovery, never from this stamped list. A model that declares no
* reasoning is returned untouched — there is no level to correct.
*/
function withEffectiveOff(models, selection) {
	return models.map((model) => model.reasoning === void 0 ? model : {
		...model,
		reasoning: {
			...model.reasoning,
			canDisableThinking: selection.has(model.id)
		}
	});
}
//#endregion
//#region src/index.ts
/** Stable Cordis plugin name. */
const name = "dsh-connect-workbuddy";
/** The model registry required before the provider can register. */
const inject = ["llm", "settings"];
/**
* Settings namespace for the plugin configuration card.
*
* (历史注记：0.1.5 线上插件自选命名空间并经 `installSection` 注册；自
* 2.1.0 起只支持 0.1.7 线，该路径已移除。) 0.1.7 的 settings 服务自行推导
* 命名空间 —— `describe()` 返回 `ns: entry.options.id`，即 Loader 条目 id
* —— 因此插件不再能自选。此常量仅作为「宿主不暴露条目 id」时的回落值；
* 实际生效值来自 {@link settingsNamespaceOf}。
*
* 这个区分不是装饰性的。宿主按**精确匹配**查表
* （模型设置页的 `namespaces.get(entry.settingsNs)`），所以宣告
* `workbuddy` 而宿主实际服务 `include:dsh-connect-workbuddy` 时，provider
* 会被判为「未配置」：配置入口与模型发现双双静默失效。
*/
/**
* The namespace the HOST actually serves this plugin under.
*
* `ctx.fiber.entry` is added by the Loader, not by Cordis itself, so it is not
* in Cordis's public types and is absent on hosts that mount a plugin without a
* Loader entry (a test harness, or `ctx.plugin()` called directly). Hence the
* probe plus the documented fallback, mirroring the first-party plugins:
* `const settingsNs = ctx.fiber.entry?.options.id ?? NS`.
*/
function settingsNamespaceOf(ctx) {
	const id = ctx?.fiber?.entry?.options?.id;
	return typeof id === "string" && id !== "" ? id : WORKBUDDY_SETTINGS_NS;
}
const modelConfig = z.object({
	id: z.string().required(),
	name: z.string().required(),
	contextWindow: z.number().step(1).min(1),
	maxTokens: z.number().step(1).min(1)
});
/**
* One region's account-pool PREFERENCES.
*
* Only user choices live here. The pool's MEASURED facts (probe outcomes,
* cooldowns, the account currently billed) are deliberately NOT part of this
* schema — see `src/account-pool-store.ts`. The card saves preferences with a
* draft-and-discard write, so storing measurements in the same slot would let
* one "Save" press overwrite results the timer had just written.
*/
const poolConfig = z.object({
	enabled: z.boolean().default(false).description("Whether this region's account pool is active (opt-in). While on, a failed chat request is retried against the other usable pool members before the error is reported."),
	targetModelId: z.string().default("").description("Model id to test; empty means pick a zero-multiplier model from this region's catalog"),
	/**
	* Sizing of the test probe, as a token count the user picks from a fixed set.
	*
	* A closed set rather than a free number: each step is a meaningful position
	* relative to the measured 20k~30k threshold, and an arbitrary value would
	* invite a size that is neither safely under nor clearly over it. `0` (and any
	* unknown value) falls back to the measured default, so a profile written by
	* an older build — and one hand-edited to something odd — behaves identically.
	*/
	probeInputTokens: z.number().step(1).default(0).description("Input tokens each test probe sends: 10000 / 20000 / 30000 / 50000 / 100000. Bigger probes catch a rate limit real conversations would hit, but cost more credit per test and may mark an account unusable for large requests only. 0 uses the measured default (25000)"),
	memberAccountIds: z.array(z.string()).default([]).description("Account ids checked into this pool (opt-in; empty means the pool covers nothing)")
});
const regionStateConfig = z.object({
	enabled: z.boolean().default(true).description("Whether this region's provider is offered to DSH (opt-out; false withdraws it entirely)"),
	lastCatalog: z.array(modelConfig).default([]),
	enabledModelIds: z.array(z.string()).default([]),
	imageModelIds: z.array(z.string()).default([]),
	/**
	* Per-model override of whether thinking `off` is offered, keyed by model id
	* (issue #34). An ABSENT key means "use the built-in rule" — the upstream's
	* `canDisableThinking` declaration minus the ids known to refuse `off` (see
	* `src/off-thinking.ts`).
	*
	* Seeded from {@link defaultOffModelIds} on first read so the checkbox is
	* ticked correctly without the user having to save.
	*/
	offModelIds: z.array(z.string()).default([]).description("Model ids whose \"off\" thinking level is offered; seeded from the built-in rule when first read."),
	contextBudgets: z.dict(z.number().step(1).min(1)).default({}),
	pool: poolConfig.default({})
});
const accountSelectionConfig = z.object({
	cn: z.string().description("Selected domestic (CN) account id (never a token)"),
	global: z.string().description("Selected international account id (never a token)")
});
/**
* Mark a schema's field as volatile on the DSH lines that support it.
*
* `volatile()` exists from schemastery 3.18.3 (the DSH 0.1.7 line, which is the
* only line whose settings write gate reads the marker). Older pinning (3.18.2,
* the 0.1.5 line) has no such method, and the schema must stay byte-identical to
* the unmarked original there: hand-writing `meta.volatile = true` would bypass
* schemastery's own validateVolatileSchema checks and produce a schema no 0.1.5
* consumer understands — so on that line this degrades to an identity no-op.
*
* Exported so BOTH arms are testable on any machine. The capability is decided
* by whichever schemastery the dependency tree resolves, so without a seam the
* no-op arm would silently stop being exercised the moment the pinned version
* moved up — which is exactly how the volatile-path defect below went unseen.
*/
function asVolatile(schema) {
	if (typeof schema.volatile === "function") return schema.volatile();
	return schema;
}
function unwrapVolatile(value) {
	if (value !== null && typeof value === "object" && "get" in value && typeof value.get === "function") return value.get();
	return value;
}
/**
* Deep copy of a config value with every `{get(): T}` live reference replaced
* by the value it resolves to.
*
* {@link unwrapVolatile} only peels the ONE level a caller reads, which is all
* the ordinary read paths need. Handing a config object to a settings service
* is different: the service validates and `structuredClone`s the WHOLE object,
* so a reference surviving anywhere inside it fails schema validation with a
* message that names the field but not the cause —
* `$.authFile expected string but got [object Object]`.
*
* That is exactly what happened on the 0.1.5 line once volatile marking became
* active: `installSection` received the raw config, whose volatile fields were
* live references, and every field it validated threw. The namespace never
* registered, so the card's settings silently disappeared.
*
* The implementation now lives in the node-free host<->client bridge, because
* the browser half needs the SAME unwrap before it spreads a resolved field —
* spreading a live reference is `{get: <function>}`, which drops every sibling
* region. It is imported and re-exported from here so the Host entry keeps
* exposing it as part of its public API.
*/
const Config = z.object({
	authFile: asVolatile(z.string().description("WorkBuddy desktop auth file (defaults to the app's own location)")),
	accountId: z.string().description("Deprecated: pre-split account selector, attributed to its own region"),
	accounts: asVolatile(accountSelectionConfig.default({}).description("Per-region account selections, keyed cn | global")),
	regions: asVolatile(z.dict(regionStateConfig).default({}).description("Per-region model directory and selection, keyed cn | global")),
	lastCatalog: z.array(modelConfig).description("Deprecated: pre-region-split CN model directory"),
	enabledModelIds: z.array(z.string()).default([]).description("Deprecated: pre-region-split CN selection"),
	imageModelIds: z.array(z.string()).default([]).description("Deprecated: pre-region-split CN image opt-in"),
	contextBudgets: z.dict(z.number().step(1).min(1)).default({}).description("Deprecated: pre-region-split CN context budgets")
});
/**
* One region's saved model state. A config written before the region split has
* only the flat fields: those were always captured from the CN endpoint (the
* plugin had no international support), so they are read as the CN state and
* only when no explicit CN slot exists. The global region never inherits them —
* that inheritance is exactly the bug where a stale CN directory was
* intersected with the international catalog and silently dropped the user's
* picks.
*/
function regionStateOf(config, region) {
	const stored = unwrapVolatile(config.regions)?.[region];
	if (stored !== void 0 && stored !== null) return stored;
	if (region !== "cn") return {};
	const lastCatalog = unwrapVolatile(config.lastCatalog);
	const enabledModelIds = unwrapVolatile(config.enabledModelIds);
	const imageModelIds = unwrapVolatile(config.imageModelIds);
	const contextBudgets = unwrapVolatile(config.contextBudgets);
	return {
		...lastCatalog === void 0 ? {} : { lastCatalog },
		...enabledModelIds === void 0 ? {} : { enabledModelIds },
		...imageModelIds === void 0 ? {} : { imageModelIds },
		...contextBudgets === void 0 ? {} : { contextBudgets }
	};
}
/**
* Whether one region's provider is switched on. Opt-out semantics: only an
* explicit `false` disables it, so every config written before this switch
* existed — including the pre-region-split flat fields, which never carry
* `enabled` — keeps both providers running exactly as before. The card reads the
* same rule through `regionEnabledOf`, so the two halves can never disagree
* about a region's state.
*/
function regionEnabled(config, region) {
	return regionStateOf(config, region).enabled !== false;
}
/** Every region, in card tab order. */
const REGION_KEYS = ["cn"];
/**
* The account id a region should select, or `undefined` for the documented
* default: follow whatever the WorkBuddy app is currently signed in as.
*
* Three inputs decide it, and the ORDER is the whole point:
*
* 1. `accounts[region] === ''` — the Clear sentinel. It means "the user
*    dropped this region's choice", which is the opposite of the key being
*    absent ("never configured"). It therefore terminates the lookup: falling
*    through to the legacy `accountId` here would re-bind the very account the
*    user just dropped, and would do it after clearing appeared to succeed.
* 2. `accounts[region]` set to a real id — an explicit per-region choice.
* 3. absent key, with the pre-split `accountId` belonging to this region —
*    the legacy migration, attributed once at startup from the local scan.
*
* `legacyAccountRegion` is resolved asynchronously after the first
* `applySelection` pass, so this is a pure function of it rather than a
* closure over the stores: the same call answers both the early pass (no
* attribution yet) and every later one.
*/
function selectAccountFor(region, value, legacyAccountRegion) {
	const configured = unwrapVolatile(value.accounts)?.[region];
	if (configured === "") return void 0;
	if (configured !== void 0) return configured;
	const accountId = unwrapVolatile(value.accountId);
	return legacyAccountRegion === region ? accountId : void 0;
}
/** Whether a region carries the Clear sentinel rather than a saved choice. */
function regionCleared(value, region) {
	return unwrapVolatile(value.accounts)?.[region] === "";
}
/**
* Which region owns the pre-split `accountId`, or `undefined` when it cannot
* be attributed (the field is absent, or the account is gone from every local
* sign-in list).
*
* Regions the user explicitly cleared are skipped, even when the saved account
* IS among their local sign-ins. `selectAccountFor` already refuses to fall
* back for a cleared region, so this cannot change what runs — but it keeps the
* attribution honest about its own decision: the region that owns this id is
* not the one the user just told the plugin to stop pinning, so the other
* region must get the chance to claim it.
*
* `accountsFor` is injected so the sequential, stop-at-first-match scan is
* testable without a filesystem.
*/
async function legacyAttributionRegion(value, accountsFor) {
	const id = value.accountId;
	if (id === void 0) return void 0;
	for (const region of REGION_KEYS) {
		if (regionCleared(value, region)) continue;
		if ((await accountsFor(region)).some((account) => account.id === id)) return region;
	}
}
/**
* Start both regions' loopback endpoints, register the `workbuddy` (CN) and
* `workbuddy-global` (international) providers, and refresh each region's
* model catalog from the upstream once that region's credentials allow it.
* The static fallback catalogs serve from the first moment, so an offline
* upstream never leaves a provider empty.
*/
function apply(ctx, config) {
	const client = new WorkBuddyUpstreamClient((message) => {
		ctx.logger.warn(`dsh-connect-workbuddy: ${message}`);
	});
	/**
	* How long a check-in reading is reused before asking the upstream again.
	*
	* The card polls the usage route every 60 seconds, but "did this account
	* check in today" changes only when a check-in runs or the day rolls over.
	* Without a cache, a 10-account pool cost ~14,400 upstream requests a day for
	* an answer that was almost always identical.
	*/
	const CHECKIN_CACHE_MS = 6e5;
	/**
	* Per-region, per-account check-in readings.
	*
	* Invalidated by this plugin's own check-in batch (the only writer that can
	* change the answer during a session), so the user sees their result
	* immediately instead of waiting out the TTL.
	*/
	const checkinStateCache = {};
	const settingsNs = settingsNamespaceOf(ctx);
	const stacks = {};
	for (const region of REGION_KEYS) {
		const authFile = unwrapVolatile(config.authFile);
		const store = createWorkBuddyKeyStore(region);
		const catalog = new WorkBuddyCatalog(region);
		catalog.set(fallbackModelsFor(region));
		stacks[region] = {
			store,
			catalog,
			shim: createWorkBuddyShim({
				store,
				client,
				catalog,
				logger: ctx.logger,
				/**
				* Pool routing, bound to THIS region.
				*
				* The region is captured in the closure rather than passed per call: each
				* region owns its own store, pool and shim, and routing that consulted the
				* other region's members would bill an account from a different account
				* pool than the one in play.
				*
				* `prepareAccount` runs before every request (so the ranking decides who
				* serves), `failoverAccount` runs after a failure (so the ranking decides
				* who to try next). Both are resolved lazily — they read pool plumbing
				* defined below — but never called before it exists: the shim only takes
				* traffic once the provider is registered, which happens after this whole
				* setup completes.
				*/
				prepareAccount: () => applyPoolSelection(region),
				failoverAccount: (triedAccountIds) => failoverAccountFor(region, triedAccountIds),
				onAccountFailure: (accountId, failure) => {
					recordAccountFailure(region, accountId, failure);
				}
			})
		};
	}
	const accountUsabilityProbe = createAccountUsabilityProbe({
		store: (region) => stacks[region].store,
		client
	});
	const withImageSelection = (models, images) => models.map((model) => ({
		...model,
		...images.has(model.id) ? { multimodal: true } : { multimodal: false }
	}));
	const configuredModels = (value, region, liveModels = []) => {
		const state = regionStateOf(value, region);
		const roster = state.lastCatalog?.length ? state.lastCatalog : liveModels.length ? liveModels : fallbackModelsFor(region);
		const declared = withImageSelection(deriveCatalog(roster, new Set(state.enabledModelIds ?? []), state.contextBudgets ?? {}), new Set(state.imageModelIds ?? []));
		return withEffectiveOff(declared, new Set(savedOffModelIds(state, declared)));
	};
	/**
	* The region's `off` selection as a Set (issue #34).
	*
	* `undefined` means "the user has never saved" — seed from the built-in rule
	* so the checkbox is ticked correctly on first read. An explicit `[]` means
	* the user UNticked everything and must stay empty: `regionStateOf` reads the
	* raw stored slot, so `undefined` and `[]` are distinguishable here, and
	* collapsing them would silently re-enable every model on the next load.
	*/
	const savedOffModelIds = (state, roster) => state.offModelIds ?? defaultOffModelIds(roster);
	const displayModels = (value, region) => {
		const state = regionStateOf(value, region);
		if (state.lastCatalog?.length) return state.lastCatalog;
		const live = stacks[region]?.catalog?.current();
		return live?.length ? live : fallbackModelsFor(region);
	};
	let current = () => config;
	let invalidateCatalog = () => {};
	/**
	* Legacy migration for the pre-split single `accountId`: its region is
	* resolved once from the local account scan and the selection is then
	* attributed to that region ONLY — the other region keeps its documented
	* default (follow the app's current sign-in) instead of silently inheriting
	* a selection that belongs to the other side of the split.
	*/
	let legacyAccountRegion;
	const effectiveAccountFor = (region, value) => selectAccountFor(region, value, legacyAccountRegion);
	const discoverModels = async (region, signal) => {
		const credential = await stacks[region].store.resolve();
		return client.fetchModels(credential, signal);
	};
	/** Push the current config into every region's store selection and catalog. */
	const applySelection = (value) => {
		const authFile = unwrapVolatile(value.authFile);
		for (const region of REGION_KEYS) {
			stacks[region].store.setDesktopPath(authFile);
			stacks[region].store.selectAccount(effectiveAccountFor(region, value));
			stacks[region].catalog.set(configuredModels(value, region, stacks[region].catalog.current()));
		}
		invalidateCatalog();
		syncRegionRegistration(value);
		refreshRegionUsability();
	};
	/**
	* Tell each catalog whether its region has ANY local sign-in, so a region the
	* user has no account for advertises nothing instead of a roster that can
	* only 401 (issue #12).
	*
	* `accounts()` is the right source rather than the SELECTED credential: an
	* orphaned saved id must not blank a region that still has other sign-ins to
	* fall back on, and a region the user deliberately cleared must come back to
	* life the moment its first account appears.
	*
	* Deliberately fire-and-forget and idempotent — it runs on every settings
	* change, and `setRegionUsable` reports whether anything moved so a
	* no-change pass costs nothing beyond the scan. A failed scan leaves the
	* previous answer alone (the catalog starts permissive), so a transient
	* filesystem error never blanks a working region.
	*/
	const refreshRegionUsability = async () => {
		for (const region of REGION_KEYS) {
			let accounts;
			try {
				accounts = await stacks[region].store.accounts();
			} catch {
				continue;
			}
			if (stacks[region].catalog.setRegionUsable(accounts.length > 0)) invalidateCatalog();
		}
	};
	/**
	* Live registration handles per region, filled once the shim is listening.
	* A disabled region holds ZERO routes while staying registered: DSH allows
	* `replace([])` for exactly this case ("a settings section that emptied holds
	* zero routes while staying registered"), which is what makes the on/off
	* switch reversible without a restart. Withdrawing the adapter route is what
	* actually removes the region's models from DSH's model picker — hiding the
	* card tab alone would leave every model selectable.
	*/
	const registration = {
		cn: {}
	};
	/**
	* Publish each region's on/off state to the harness (issue #11-style region
	* switch). Both swaps are single synchronous sections, so no request can
	* observe a half-applied state, and `replace` announces itself through
	* `llm/adapters-updated`, which is what makes third-party consumers drop the
	* region too. No-op until the shim has registered; `applySelection` runs again
	* on every card write (and once more after registration completes), so a
	* toggle lands immediately.
	*/
	const syncRegionRegistration = (value) => {
		for (const region of REGION_KEYS) registration[region].adapter?.replace(regionEnabled(value, region) ? [WORKBUDDY_PROVIDERS[region]] : []);
		registration.cn.directory?.replace(REGION_KEYS.filter((region) => regionEnabled(value, region)).map((region) => ({
			provider: WORKBUDDY_PROVIDERS[region],
			displayName: WORKBUDDY_PROVIDER_DISPLAY_NAMES[region],
			settingsNs,
			settingsPath: [],
			declared: false
		})));
	};
	ctx.inject(["webServer"], (webCtx) => registerWorkBuddyStatusRoute(webCtx, {
		store: (region) => stacks[region].store,
		client,
		accountUsable: accountUsabilityProbe,
		displayModels: (region) => displayModels(current(), region),
		enabledModelIds: (region) => regionStateOf(current(), region).enabledModelIds ?? [],
		imageModelIds: (region) => regionStateOf(current(), region).imageModelIds ?? [],
		offModelIds: (region) => savedOffModelIds(regionStateOf(current(), region), displayModels(current(), region)),
		contextBudgets: (region) => regionStateOf(current(), region).contextBudgets ?? {},
		discoverModels,
		regionEnabled: (region) => regionEnabled(current(), region),
		/**
		* One minimal request per named model, through the region's own credential.
		*
		* Resolved here rather than in the route so the browser half never touches a
		* token: the route passes only model ids and receives only outcomes.
		*
		* `quotaRefreshAtMs` is the region's nearest monthly refresh point, read from
		* the SAME credit answer the card displays. It is the only cooldown this
		* service ever states — an exhausted monthly resource that resets at a known
		* time — so it is what makes "when can I use this again" answerable for an
		* out-of-credit result. Every other limited outcome has no time anywhere, and
		* the probe reports exactly that instead of inventing one.
		*/
		async probeModels(region, modelIds, options) {
			let credential;
			try {
				credential = await stacks[region].store.resolve();
			} catch (error) {
				return modelIds.map((modelId) => ({
					modelId,
					outcome: "credential-rejected",
					message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
				}));
			}
			const quotaRefreshAtMs = await quotaRefreshOf(region, credential);
			const results = [];
			for (const modelId of modelIds) results.push(await probeModel({
				client,
				credential,
				modelId,
				nowMs: Date.now(),
				...quotaRefreshAtMs === void 0 ? {} : { quotaRefreshAtMs },
				...options?.signal === void 0 ? {} : { signal: options.signal }
			}));
			return results;
		},
		regionUsable(region, usable) {
			if (stacks[region].catalog.setRegionUsable(usable)) invalidateCatalog();
		},
		/**
		* The account pool, resolved per region.
		*
		* Region-scoped throughout: the CN and international pools are separate
		* stacks of accounts, so one region's pool can never rank or bill the
		* other's accounts.
		*
		* The pool decides who serves a FAILED request (see `failoverAccountFor`),
		* and it does so without writing `config.accounts[region]`: a retry borrows
		* another member's credential for that one request, leaving the record of
		* what the user picked — and the account the next request starts from —
		* untouched.
		*/
		pool: {
			preferences: (region) => poolPreferencesOf(current(), region),
			members: (region) => poolMembersOf(region),
			/**
			* The checked accounts that resolve to a local sign-in.
			*
			* A local scan only — no upstream calls — so the route's empty-pool guard
			* can use it on every batch. {@link poolMembersOf} is the expensive one
			* (it fetches credits per account) and is not suitable there.
			*/
			effectiveMemberAccountIds: async (region) => {
				const saved = poolPreferencesOf(current(), region).memberAccountIds;
				if (saved.length === 0) return [];
				const accounts = await stacks[region].store.accounts();
				return effectiveMembersOf(saved, new Set(accounts.map((account) => account.id)));
			},
			/**
			* Local sign-ins the pool does NOT cover.
			*
			* Sent so the card can offer them to check in. Membership is an explicit
			* opt-in, and a user cannot opt in to an account the card never shows.
			*/
			async otherAccounts(region) {
				const wanted = new Set(poolPreferencesOf(current(), region).memberAccountIds);
				return (await stacks[region].store.accounts()).filter((account) => !wanted.has(account.id)).map((account) => ({
					id: account.id,
					accountName: account.accountName
				}));
			},
			/**
			* Today's check-in state per account, for the pool table.
			*
			* Read per account through `credentialFor` (never `resolve`), so asking
			* about an account cannot change which one is billing. A per-account
			* failure is simply omitted, which the card renders as unknown.
			*/
			async checkedInToday(region) {
				if (!poolPreferencesOf(current(), region).enabled) return {};
				const store = stacks[region].store;
				const accounts = await store.accounts();
				const now = Date.now();
				const entries = await Promise.all(accounts.map(async (account) => {
					const cached = checkinStateCache[region]?.[account.id];
					if (cached !== void 0 && now - cached.atMs < CHECKIN_CACHE_MS) return [account.id, cached.checkedIn];
					const credential = await store.credentialFor(account.id).catch(() => void 0);
					if (credential === void 0) return void 0;
					const status = await client.fetchCheckinStatus(credential).catch(() => void 0);
					if (status === void 0) return void 0;
					checkinStateCache[region] = {
						...checkinStateCache[region],
						[account.id]: {
							checkedIn: status.todayCheckedIn,
							atMs: now
						}
					};
					return [account.id, status.todayCheckedIn];
				}));
				return Object.fromEntries(entries.filter((entry) => entry !== void 0));
			},
			async currentAccountId(region) {
				await applyPoolSelection(region).catch(() => void 0);
				const credential = await stacks[region].store.current().catch(() => void 0);
				if (credential === void 0) return void 0;
				if (await servingAccountIsExcluded(region).catch(() => false)) return void 0;
				return workbuddyAccountId(credential);
			},
			/**
			* Only the CN app rewards a daily check-in; the international region has
			* no equivalent here, so its card must not offer the action.
			*/
			checkinSupported: (region) => region === "cn",
			checkin: async (region) => {
				const rows = await checkinAllAccounts(await poolTargets(region), poolRunnerDeps(region));
				for (const row of rows) {
					if (row.status === "failed") continue;
					const cached = checkinStateCache[region];
					if (cached !== void 0) delete cached[row.accountId];
				}
				return rows;
			},
			test: async (region, modelId, onRow) => {
				const rows = await testAllAccounts(await poolTargets(region), modelId, poolRunnerDeps(region), onRow);
				await writePoolProbes(region, probeUpdatesOf(rows));
				return rows;
			},
			catalog: (region) => displayModels(current(), region)
		}
	}));
	/**
	* The region's nearest monthly quota refresh, or undefined when unknown.
	*
	* The monthly resource (`CapacityType 4`) is the one package that never
	* expires and resets on a cycle, so its `refreshAtMs` is a real answer to
	* "when can I use this again" after the quota runs out. The probe passes it
	* through; a failure to read it is not an error, because a probe without a
	* cooldown is still a useful probe.
	*/
	const quotaRefreshOf = async (region, credential) => {
		try {
			const refreshes = (await client.fetchCredits(credential)).packages.filter((pack) => pack.monthly && pack.refreshAtMs !== void 0).map((pack) => pack.refreshAtMs);
			return refreshes.length === 0 ? void 0 : Math.min(...refreshes);
		} catch {
			return;
		}
	};
	/**
	* The next account to try for a request whose current account just failed,
	* or `undefined` when this region's pool has nobody left.
	*
	* Reads the pool's EXISTING measurements instead of probing: a request that
	* just failed must not spend further requests deciding who serves next (and a
	* probe of the target model would itself be billed). Candidates are this
	* region's checked-in members in rank order, minus everyone this request has
	* already tried, minus anyone a measurement says cannot serve right now — a
	* limited account whose stated cooldown has not elapsed, or one whose
	* credential the upstream rejected.
	*
	* The pool switch gates this: off means the user's account serves every
	* request and a failure is reported as-is, exactly as before the pool existed.
	*
	* Reads the candidate through `credentialFor()`, never `resolve()`: the saved
	* selection and the store's runtime state stay untouched, so this is
	* per-request borrowing rather than a silent change of who pays.
	*
	* Uses `localPoolMembers`, NOT `poolMembersOf`. This runs on the failure path
	* of a request the user is already waiting on, and `poolMembersOf` fetches
	* credits per member — so the expensive version turned one failed request into
	* N extra upstream calls before the retry even left. The doc above always said
	* "must not spend further requests"; the code used to contradict it. Credits
	* still steer the ranking when a recent snapshot exists, because
	* `localPoolMembers` reads the one the card's poll already paid for.
	*/
	const failoverAccountFor = async (region, triedAccountIds) => {
		if (!poolPreferencesOf(current(), region).enabled) return void 0;
		const tried = new Set(triedAccountIds);
		for (const row of rankPool(await localPoolMembers(region), Date.now())) {
			if (row.excludedBy !== void 0) continue;
			if (tried.has(row.account.id)) continue;
			const credential = await stacks[region].store.credentialFor(row.account.id);
			if (credential !== void 0) return credential;
		}
	};
	/**
	* The last CREDITS reading per region, so a request can rank by balance
	* without fetching one.
	*
	* Credits are the ranking's second key, and they cost an upstream call per
	* member. A chat request must never pay that: it happens on the hot path, and
	* `fetchCredits` per member would turn one page of conversation into N extra
	* requests. So the request path uses whatever the pool last read (the card's
	* 60-second poll, a batch test, or a save) and simply skips the key when the
	* snapshot is too old to speak for today's balances.
	*/
	const creditsSnapshot = {};
	/** How long a credits reading may steer routing. */
	const CREDITS_SNAPSHOT_MS = 6e5;
	/** When each region's snapshot was taken, for the freshness check above. */
	const creditsSnapshotAt = {};
	/**
	* One region's pool members from LOCAL sources only: the credential store and
	* the probe store, plus the credits snapshot when it is fresh.
	*
	* The request path calls this on every chat completion, so it must not touch
	* the network. `poolMembersOf` is the honest-but-expensive version (it fetches
	* credits per member) and stays on the card's route, which is where those
	* readings come from in the first place.
	*/
	async function localPoolMembers(region) {
		const accounts = await poolMemberAccounts(region);
		const probes = await readPoolProbes(region);
		const credits = Date.now() - (creditsSnapshotAt[region] ?? 0) <= CREDITS_SNAPSHOT_MS ? creditsSnapshot[region] : void 0;
		return accounts.map((account) => {
			const reading = credits?.get(account.id);
			return {
				account: {
					id: account.id,
					accountName: account.accountName
				},
				...reading === void 0 ? {} : { credits: reading },
				...probes[account.id] === void 0 ? {} : { probe: probes[account.id] },
				tokenExpiresAtMs: account.tokenExpiresAtMs
			};
		});
	}
	/**
	* Record a failure a LIVE request hit, so the NEXT request starts from a
	* usable account.
	*
	* Without this the ranking only knew what the manual batch test had measured:
	* an account that had just answered 429 carried no measurement, so
	* `exclusionOf` returned "candidate" and the ranking kept picking it — every
	* request paid one failed round trip before failing over. Keeping traffic off
	* an account the upstream just refused is the pool's whole point
	* (`account-pool.ts` says exactly that about `rate-limited`), and it only
	* works if live failures count as measurements.
	*
	* Deliberately NOT recorded for `client` (HTTP 400): the upstream rejected the
	* REQUEST, which says nothing about the account, and recording it would
	* sideline a good account over a bad body.
	*
	* The reset time comes from the upstream's own words — the 429 body carries
	* 「将在 … 重置」 — which `cooldownOf` parses. When it states no time, the store's
	* own short window applies rather than a guess at a long one.
	*
	* The upstream's text is persisted alongside the outcome so the card can name
	* the reason. It is REDACTED first because this message is a raw upstream body:
	* without that, a failure containing a token-shaped string would write it into
	* a file on disk.
	*/
	const recordAccountFailure = async (region, accountId, failure) => {
		if (!poolPreferencesOf(current(), region).enabled) return;
		if (failure.kind === "client") return;
		const members = poolPreferencesOf(current(), region).memberAccountIds;
		if (members.length > 0 && !members.includes(accountId)) return;
		const outcome = outcomeOfFailure(failure.status, failure.message);
		const { retryAtMs } = cooldownOf({
			outcome,
			retryAfter: null,
			nowMs: Date.now(),
			body: failure.message
		});
		const message = failure.message === "" ? "" : redactUpstreamText(failure.message);
		await writePoolProbes(region, { [accountId]: {
			outcome,
			atMs: Date.now(),
			source: "live-request",
			...retryAtMs === void 0 ? {} : { retryAtMs },
			...message === "" ? {} : { message }
		} });
	};
	/**
	* Point this region's store at whoever the pool's ranking says should serve.
	*
	* Called once per chat request. With the pool ON the ranking decides the
	* serving account — the whole point of the switch, and the reason the card can
	* show a "current account" that is not simply the saved selection. With the
	* pool OFF the override is CLEARED, which restores the user's own choice
	* immediately: leaving a stale override in place would keep billing under a
	* switch that reads as off.
	*
	* The override is runtime-only and never written to settings, so the user's
	* recorded choice survives untouched either way — turning the pool off gives
	* it back verbatim.
	*
	* Best-effort: a failure here leaves the previous state in effect, and the
	* request still goes out (to the user's account when the pool is off, which is
	* the safe default).
	*/
	const applyPoolSelection = async (region) => {
		const store = stacks[region].store;
		if (!poolPreferencesOf(current(), region).enabled) {
			store.setRotatedAccount(void 0);
			return;
		}
		const winner = rankPool(await localPoolMembers(region), Date.now()).find((row) => row.excludedBy === void 0);
		store.setRotatedAccount(winner?.account.id);
	};
	/**
	* Whether the account the store would bill is one the pool has measured as
	* unusable.
	*
	* The two questions differ exactly when the pool runs out of usable members: a
	* REQUEST still has to go somewhere (the saved selection), but the CARD must
	* not label that account "in use" while the same table says it is rate-limited.
	* One screen contradicting itself is how a user learns to trust neither half —
	* and "the pool moved to an available account" is unverifiable if the display
	* keeps naming an account the table calls excluded.
	*/
	const servingAccountIsExcluded = async (region) => {
		if (!poolPreferencesOf(current(), region).enabled) return false;
		const credential = await stacks[region].store.current().catch(() => void 0);
		if (credential === void 0) return false;
		const servingId = workbuddyAccountId(credential);
		const row = rankPool(await localPoolMembers(region), Date.now()).find((candidate) => candidate.account.id === servingId);
		return row !== void 0 && row.excludedBy !== void 0;
	};
	/**
	* One region's POOL members, each with its credits and last measurement.
	*
	* Only CHECKED accounts: an unchecked account is not a candidate to bill, so
	* it must not reach the ranking that decides who serves.
	*
	* Read through `credentialFor()` — never `resolve()` — so no account's
	* selection state is touched: a batch must measure every member without
	* changing which one is billing. Credits are fetched per account and a
	* failure degrades to "unknown" for that row only — one unreadable balance
	* must not blank the whole pool.
	*/
	async function poolMembersOf(region) {
		const store = stacks[region].store;
		const accounts = await poolMemberAccounts(region);
		const probes = await readPoolProbes(region);
		const rows = await Promise.all(accounts.map(async (account) => {
			const credential = await store.credentialFor(account.id).catch(() => void 0);
			const credits = credential === void 0 ? void 0 : await client.fetchCredits(credential).catch(() => void 0);
			return {
				account: {
					id: account.id,
					accountName: account.accountName
				},
				...credits === void 0 ? {} : { credits: {
					total: credits.total,
					expiringSoon: credits.expiringSoon,
					...credits.nearestExpiryMs === void 0 ? {} : { nearestExpiryMs: credits.nearestExpiryMs }
				} },
				...probes[account.id] === void 0 ? {} : { probe: probes[account.id] },
				tokenExpiresAtMs: account.tokenExpiresAtMs
			};
		}));
		creditsSnapshot[region] = new Map(rows.filter((row) => row.credits !== void 0).map((row) => [row.account.id, row.credits]));
		creditsSnapshotAt[region] = Date.now();
		return rows;
	}
	/** One region's pool preferences, with the schema's defaults applied. */
	const poolPreferencesOf = (config, region) => {
		const pool = regionStateOf(config, region).pool;
		const probeInputTokens = pool?.probeInputTokens;
		return {
			enabled: pool?.enabled === true,
			targetModelId: pool?.targetModelId ?? "",
			...probeInputTokens === void 0 ? {} : { probeInputTokens },
			memberAccountIds: pool?.memberAccountIds ?? []
		};
	};
	/**
	* The accounts the user has checked into this region's pool.
	*
	* Membership is an EXPLICIT opt-in list, not "every local sign-in": the two
	* batch actions spend real credits and claim real rewards, so which accounts
	* they touch has to be the user's decision rather than a side effect of
	* having signed in on this machine. An account that is not checked is
	* untouched by check-in, testing, and rotation alike.
	*/
	async function poolMemberAccounts(region) {
		const saved = poolPreferencesOf(current(), region).memberAccountIds;
		if (saved.length === 0) return [];
		const accounts = await stacks[region].store.accounts();
		const byId = new Map(accounts.map((account) => [account.id, account]));
		return effectiveMembersOf(accounts.map((account) => account.id), new Set(saved)).flatMap((id) => {
			const account = byId.get(id);
			return account === void 0 ? [] : [account];
		});
	}
	/** The batch runner's view of one region's pool members. */
	async function poolTargets(region) {
		return (await poolMemberAccounts(region)).map((account) => ({
			accountId: account.id,
			accountName: account.accountName
		}));
	}
	/**
	* The two actions' shared dependency set.
	*
	* `credentialFor` — never `resolve()` — is what makes a batch possible at
	* all: it fetches any account's credential WITHOUT changing the region's
	* selection, so testing every account cannot switch the account that bills
	* the user's live traffic.
	*/
	function poolRunnerDeps(region) {
		const store = stacks[region].store;
		return {
			credentialFor: (accountId) => store.credentialFor(accountId),
			fetchCheckinStatus: (credential) => client.fetchCheckinStatus(credential),
			claimDailyCheckin: (credential) => client.claimDailyCheckin(credential),
			probe: async (credential, modelId) => {
				const quotaRefreshAtMs = await quotaRefreshOf(region, credential);
				const inputTokens = resolveProbeInputTokens(poolPreferencesOf(current(), region).probeInputTokens);
				return probeModel({
					client,
					credential,
					modelId,
					nowMs: Date.now(),
					inputTokens,
					...quotaRefreshAtMs === void 0 ? {} : { quotaRefreshAtMs }
				});
			}
		};
	}
	ctx.inject(["settings"], (sctx) => {
		const settings = sctx.settings;
		ctx.effect(() => settings.configure({ auto: true }, ctx.fiber));
	});
	ctx.on("loader/volatile-update", () => {
		applySelection(current());
	});
	applySelection(config);
	(async () => {
		try {
			const region = await legacyAttributionRegion(current(), async (candidate) => stacks[candidate].store.accounts());
			if (region === void 0) return;
			legacyAccountRegion = region;
			applySelection(current());
		} catch {}
	})();
	let stopped = false;
	ctx.effect(() => () => {
		stopped = true;
		for (const region of REGION_KEYS) stacks[region].shim.close();
		clearHostHeartbeat();
	});
	Promise.all(REGION_KEYS.map((region) => stacks[region].shim.ready)).then(async () => {
		if (stopped) return;
		const adapters = {};
		try {
			for (const region of REGION_KEYS) adapters[region] = createWorkBuddyAdapter({
				shim: stacks[region].shim,
				store: stacks[region].store,
				catalog: stacks[region].catalog,
				provider: WORKBUDDY_PROVIDERS[region],
				displayName: WORKBUDDY_PROVIDER_DISPLAY_NAMES[region],
				resolveAttachments: () => ctx.get("attachments")
			});
			invalidateCatalog = () => {
				for (const region of REGION_KEYS) adapters[region].invalidate();
			};
			let releaseAdapterCn;
			let releaseDirectory;
			try {
				releaseAdapterCn = registration.cn.adapter = ctx.llm.registerAdapter([WORKBUDDY_PROVIDER], adapters.cn.adapter);
				releaseDirectory = registration.cn.directory = ctx.llm.registerConfigurableProviders([{
					provider: WORKBUDDY_PROVIDER,
					displayName: WORKBUDDY_PROVIDER_DISPLAY_NAMES.cn,
					settingsNs,
					settingsPath: [],
					declared: false
				}]);
			} finally {
				if (releaseAdapterCn === void 0 || releaseDirectory === void 0) {
					releaseAdapterCn?.();
					releaseDirectory?.();
				}
			}
			try {
				ctx.effect(() => () => {
					releaseAdapterCn?.();
					releaseDirectory?.();
				});
			} catch {
				releaseAdapterCn?.();
				releaseDirectory?.();
			}
			syncRegionRegistration(current());
			ctx.llm.registerModelDiscovery(settingsNs, async (request, signal) => {
				const region = regionOfProvider(request.provider ?? "");
				if (region === void 0) return [];
				if (!regionEnabled(current(), region)) return [];
				const discovered = await discoverModels(region, signal);
				const state = regionStateOf(current(), region);
				return withImageSelection(deriveCatalog(discovered, new Set(state.enabledModelIds ?? []), state.contextBudgets ?? {}), new Set(state.imageModelIds ?? [])).map((model) => ({
					id: model.id,
					name: workBuddyDisplayName(model),
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					inputModalities: workBuddyModelInput(model)
				}));
			});
			writeHostHeartbeat();
		} catch (error) {
			ctx.logger.error("dsh-connect-workbuddy: provider registration failed", error);
			return;
		}
		if (stopped) return;
		for (const region of REGION_KEYS) {
			if (!regionEnabled(current(), region)) continue;
			(async () => {
				try {
					const credential = await stacks[region].store.resolve();
					if (stopped) return;
					const models = await client.fetchModels(credential);
					if (stopped) return;
					const state = regionStateOf(current(), region);
					stacks[region].catalog.set(withEffectiveOff(withImageSelection(deriveCatalog(models, new Set(state.enabledModelIds ?? []), state.contextBudgets ?? {}), new Set(state.imageModelIds ?? [])), new Set(savedOffModelIds(state, models))));
					adapters[region].invalidate();
				} catch (error) {
					ctx.logger.warn(`dsh-connect-workbuddy: dynamic ${region} model catalog unavailable; serving the static fallback list`, error);
				}
			})();
		}
	}).catch((error) => {
		ctx.logger.error("dsh-connect-workbuddy: loopback endpoint failed to start; providers not registered", error);
	});
}
//#endregion
export { CREDENTIAL_REJECTED_CODE, Config, DEFAULT_PROBE_INPUT_TOKENS, ENCRYPTED_CREDENTIAL_CODE, FALLBACK_WORKBUDDY_MODELS, FALLBACK_WORKBUDDY_MODELS_GLOBAL, NATIVE_MODALITY_BY_MODEL_ID, PROBE_INPUT_TOKEN_CHOICES, PROBE_MAX_TOKENS, PROBE_SYSTEM_PROMPT, REFUSES_OFF_MODEL_IDS, WORKBUDDY_ACCOUNTS_REFRESH_PATH, WORKBUDDY_APP_EXECUTABLE_ENV, WORKBUDDY_AUTH_FILENAME, WORKBUDDY_AUTH_FILE_ENV, WORKBUDDY_CHECKIN_PATH, WORKBUDDY_CONNECT_VERSION, WORKBUDDY_GLOBAL_PROVIDER, WORKBUDDY_HOST_HEARTBEAT_FILENAME, WORKBUDDY_MODELS_REFRESH_PATH, WORKBUDDY_PROBE_PATH, WORKBUDDY_PROVIDER, WORKBUDDY_PROVIDERS, WORKBUDDY_PROVIDER_DISPLAY_NAMES, WORKBUDDY_REGIONS, WORKBUDDY_REGION_PARAM, WORKBUDDY_SETTINGS_NS, WORKBUDDY_STREAM_IDLE_TIMEOUT_MS, WORKBUDDY_USAGE_PATH, WorkBuddyCatalog, WorkBuddyCredentialRejectedError, WorkBuddyCredentialStore, WorkBuddyEncryptedCredentialError, WorkBuddyUpstreamClient, apply, asVolatile, authFileName, classifyUpstreamError, clearAtRestKeyCache, clearHostHeartbeat, cooldownOf, createAccountUsabilityProbe, createWorkBuddyAdapter, createWorkBuddyShim, creditOfStream, defaultDesktopAuthCandidates, defaultDesktopAuthDirs, defaultDesktopAuthPath, defaultOffModelIds, deriveAtRestKey, deriveAtRestKeyId, deriveCatalog, fallbackModelsFor, fetchAtRestKeyPayload, findWorkbuddyAppExecutable, hasEncryptedCredentialFields, imageDefaultFor, inject, isCredentialRejectedError, isEncryptedCredentialError, isEncryptedFieldWrapper, isHeartbeatProcessAlive, isWorkbuddyBundle, legacyAttributionRegion, legacyWorkbuddyOwnAuthPath, macosBundleExecutable, macosNestedAppBundles, name, nativeModalityOf, nextRegionEnabled, nextRegionSlots, offDefaultFor, openEncryptedField, outcomeOfFailure, parseCreditMultiplier, parseReasoning, parseRetryAfter, parseUpstreamModel, parseWorkBuddyAuth, prepareChatBody, probeModel, probeRequestBody, probeSucceeded, processStartTimeMs, readAtRestKey, readHostHeartbeat, regionCleared, regionEnabled, regionEnabledOf, regionOf, regionOfProvider, regionOfStatusUrl, regionStateOf, registerWorkBuddyStatusRoute, resolveCredentialRecovery, selectAccountFor, settingsNamespaceOf, toPersistedWorkBuddyModel, unwrapVolatileDeep, withEffectiveOff, withWorkBuddyRegion, workBuddyDisplayName, workBuddyModelInput, workBuddyThinkingLevelMap, workBuddyWebStatus, workbuddyAccountId, workbuddyAppExecutableCandidates, workbuddyHostHeartbeatPath, workbuddyOwnAuthPath, writeHostHeartbeat };
