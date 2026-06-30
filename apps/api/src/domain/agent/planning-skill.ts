import type { FileData } from "deepagents";
import type { AgentSkillTriggerMode } from "../contracts.js";

export const CANVAS_IMAGE_PLANNING_SKILL_VERSION = "canvas-image-planning@2" as const;
export const CANVAS_IMAGE_PLANNING_SKILL_PATH = "/skills/canvas-image-planning/SKILL.md" as const;
export const ECOMMERCE_VISUAL_COPYWRITING_SKILL_VERSION = "ecommerce-visual-copywriting@1" as const;
export const ECOMMERCE_VISUAL_COPYWRITING_SKILL_PATH = "/skills/ecommerce-visual-copywriting/SKILL.md" as const;
export const ECOMMERCE_VISUAL_COPYWRITING_COMPLIANCE_RULES_PATH =
  "/skills/ecommerce-visual-copywriting/references/compliance-rules.md" as const;

export interface PlanningSkillFile {
  path: string;
  content: string;
}

export interface PlanningSkillLoadoutSkill {
  slug: string;
  name: string;
  version?: string;
  required: boolean;
  triggerMode: AgentSkillTriggerMode;
  files: PlanningSkillFile[];
}

export interface PlanningSkillLoadout {
  skills: PlanningSkillLoadoutSkill[];
}

export const CANVAS_IMAGE_PLANNING_SKILL = `---
name: canvas-image-planning
description: Turn a creator image request into strict GenerationPlan JSON for the canvas.
metadata:
  version: "2"
---
# Canvas Image Planning Skill v2

You create inspectable canvas image generation plans. Return exactly one JSON object and no markdown, commentary, code fences, or trailing text.

Most responses must be a GenerationPlan:
- schemaVersion: 1
- id: a short temporary id such as "plan-draft"
- title: concise human-readable title
- status: "awaiting_confirmation"
- defaults: { size: { width, height }, quality, outputFormat, count? }
- jobs: one or more GenerationJob objects
- edges: dependency edges from source job to downstream job
- createdBy: "agent"
- createdAt and updatedAt: ISO strings; the server may replace them

Each GenerationJob must include:
- id: stable snake_case id unique within the plan
- role: "final_image", "variation", "character_anchor", "style_anchor", or "reference_anchor"
- prompt: complete image prompt
- count: requested generated image count for this job. Must be an integer from 1 to 16.
- size, quality, and outputFormat only when overriding defaults. quality must be "auto", "low", "medium", or "high"; outputFormat must be "png", "jpeg", or "webp".
- references: array of selected_canvas_image or generated_output references
- status: "queued"
- outputs: []
- visible: true

If missing user input makes a safe plan impossible, return an AgentUserQuestion instead:
- kind: "agent_user_question"
- code: "missing_selected_canvas_reference" or "agent_requires_user_input"
- message: concise user-facing question or instruction
- createdBy: "agent"

Core rules:
1. The plan only describes work. Never claim execution has started or completed. The user must confirm before execution.
2. Sum every job.count, including character/style/reference anchors and final images. The total must be 16 or less.
2a. A single coherent job may request any count from 1 to 16, such as count 3, 5, or 9. Do not split a job only because of provider batch sizes.
3. Each job may use at most 3 resolved reference images. The request context may list up to 16 selected canvas references for batch work; split batch edits into separate jobs instead of placing more than 3 references on one job.
4. A dependency source job used by any downstream edge or generated_output reference must have count exactly 1.
5. Generated intermediate anchors are visible canvas images, not hidden scratch assets, and they count against the 16-image cap.
6. If the user asks for a reusable character or story continuity and no user image is supplied, you may create one visible character_anchor job with count 1 and downstream generated_output references to it.
7. selected_canvas_image references must use only the selected reference handles provided in the request context. Prefer the displayed refN handle such as "ref1", or copy the exact id/assetId from the same line.
8. generated_output references must point to a known source job. Add a matching dependency edge from that source job to the downstream job.
9. Do not create dependency cycles.
10. If supportsVision is false, selected images are only handles/summaries for later image generation. Do not say that you looked at, inspected, or saw the image contents.

Node planning patterns:

Pattern A: selected-image direct edit
- Use this when selected canvas references exist and the user asks to edit, modify, add text/captions/titles/copy, overlay typography, polish, retouch, or otherwise directly change selected or original image(s).
- Every final_image job for that selected-image edit work must include at least one selected_canvas_image reference.
- Prompts must say to edit the original image directly, preserve the scene/photo content, composition, perspective, and main subjects, and add only the requested design/text treatment.
- Never make a blank poster, generic geometric template, unrelated background, or replacement image for this pattern.
- If selected canvas references exist and this pattern applies, do not ask whether to edit the originals or create a new design. Assume the selected references are the edit sources and return a GenerationPlan.

Pattern A2: selected-image creative reference
- Use this when selected canvas references exist and the user asks to generate/create/make new images, portraits, style variants, or visual reinterpretations based on/reference/from an uploaded, selected, source, or original image.
- Also use this when the user explicitly allows different pose, action, clothing, background, scene, composition, or style. In that case, do not force the original pose, action, composition, or scene into the prompt.
- Every final_image job for this work must include the selected_canvas_image references used as subject, character, product, or style references.
- For child, person, portrait, photoshoot, avatar, or identity-reference requests, set every selected_canvas_image reference usage to "subject" unless the user asks for a reusable story character, in which case "character" is also valid. Do not use usage "other" for identity or portrait references.
- Prompts must say to use the selected image as a reference for the subject/identity/style and create a new image. Do not say "edit the original image", "preserve the pose", "preserve the composition", or "preserve the original scene" unless the user explicitly requests exact preservation.
- Keep the referenced subject recognizable and do not replace it with an unrelated subject.

Pattern B: batch selected-image edit
- Use this when the user says each image, every image, all selected images, 每張圖, 每一張, 所有圖, 全部圖片, or similar.
- Prefer one final_image job per selected reference with count 1 and exactly one selected_canvas_image reference.
- You may choose a different job structure only if the user explicitly asks to combine images or use multiple references together.
- The final plan must cover every selected reference in at least one final_image job.

Pattern C: combine/collage selected references
- Use this when the user asks to combine, collage, merge, compare, make one poster from multiple images, 拼貼, 合成, 組合, 放在一起, or similar.
- A single final_image job may reference multiple selected_canvas_image references.
- If the user asks to combine more than 3 selected references into one image, return AgentUserQuestion with code "agent_requires_user_input" asking them to select 3 or fewer images or split the output.
- The prompt must state how the selected references are used together.

Pattern D: human-in-loop
- If the request depends on an original/selected image but no selected canvas reference is available, return AgentUserQuestion with code "missing_selected_canvas_reference".
- If the request is ambiguous between editing selected originals and generating a new design, return AgentUserQuestion with code "agent_requires_user_input" only when the selected reference context does not already make the user's intent clear.
- Do not return AgentUserQuestion for straightforward selected-reference edits such as adding text, captions, titles, or typography to each selected image. Plan the edit jobs instead.
- Do not invent or hallucinate selected_canvas_image references.

Anti-patterns:
- Do not collapse an explicit request for N images, variants, or different prompts into one selected-image edit job with count 1. Preserve the requested final output count even when one or more canvas references are selected.
- Do not treat "collage-style", "magazine collage", or similar visual-style language as a request to combine selected references. Combine selected references only when the user explicitly asks to combine, merge, compare, or make one image/poster from multiple selected images.
- When up to 3 selected references are present and the user asks for N variants, it is valid to create N final_image jobs that each reference the selected source set and use distinct prompts.
`;

export const ECOMMERCE_VISUAL_COPYWRITING_SKILL = `---
name: ecommerce-visual-copywriting
description: Optimize ecommerce main-image and product-detail-page generation plans with compliant visual copywriting.
metadata:
  version: "1"
  source: "https://github.com/feichanggege/ecommerce-visual-copywriting-skill"
---
# Ecommerce Visual Copywriting Skill v1

Use this skill when the user asks for ecommerce scenarios such as:
- 主圖文案, 詳情頁文案, 電商文案, 商品文案, listing copy, product detail page, CTR optimization
- 淘寶, 天貓, 京東, 拼多多, 抖音小店, marketplace hero images, product posters, product cards
- compliance review, 廣告法, platform review, health-food copy, ordinary food copy, sports-equipment copy

This skill adapts the ecommerce SOP to gpt-image-canvas. You must still return exactly one strict GenerationPlan JSON object, or an AgentUserQuestion when required. Put ecommerce copy, scene direction, compliance notes, and design instructions inside each GenerationJob.prompt. Do not output Markdown execution plans, tables, or prose outside JSON.

Reference:
- Before ecommerce output, apply the product-type rules from ${ECOMMERCE_VISUAL_COPYWRITING_COMPLIANCE_RULES_PATH}.
- Treat the reference file as the detailed compliance authority when it is stricter than this summary.

Ecommerce planning workflow:
1. Classify product type: blue-hat health food, ordinary food, sports equipment/body-management product, or other.
2. Extract 3-5 compliance-safe selling reasons from verifiable facts only.
3. Convert the selling reasons into main-image and detail-page visual jobs, staying within the 16-image plan cap.
4. For every ecommerce job prompt, include three compact sections: picture content, on-image copy, and design scene direction.
5. Self-review internally before returning JSON. The plan should score at least 80/100 for copy brevity, image fit, compliance, clear structure, and designer usefulness.

Required input gates:
- If the user requests a full ecommerce listing set and product type is missing for food, supplement, health, body-management, or sports-equipment categories, return AgentUserQuestion with code "agent_requires_user_input" asking for product type and permitted claims.
- If the request needs factual claims, prices, certifications, reports, approval numbers, company name, or SKU details that the user did not provide, do not invent them. Either omit the claim or ask a concise AgentUserQuestion when the missing fact is central.
- If selected product photos exist and the user asks to add ecommerce copy or redesign product visuals, apply the selected-image edit patterns from canvas-image-planning and preserve the original product/photo content.

Main-image structure:
- Plan up to 5 main-image jobs when the user asks for a main-image set: hero CTR image, pain/scenario image, differentiated advantage image, use-scenario image, and CTA/trust image.
- Each main image should use at most 5 on-image copy lines. Titles should be short, usually 5-10 Chinese characters or similarly compact English.
- Copy should be specific, scannable, and drawable. Avoid long explanations, teaching paragraphs, and tiny disclaimer walls.

Detail-page structure:
- Choose only useful modules instead of always generating all modules.
- Good modules include: first-screen scenario hook, core advantage expansion, ingredient/material/process explanation, use scenarios, brand/qualification trust, SKU/specification comparison, FAQ, and purchase/legal notice.
- Each detail module should use at most 6 effective on-image text lines.

Compliance rules:
- All products: avoid absolute or unverifiable claims such as 唯一, 最, 第一, 絕對, 頂級, 完美, 100%, 國家級, 特效, guaranteed, best, cure, permanent, or miracle.
- Data such as percentages, multipliers, 未檢出, certificates, approvals, patents, and testing claims require a provided report number, certificate number, source, or approval text. If absent, remove or soften the claim.
- Do not directly disparage competitor brands or make binary "we are good, they are bad" comparisons.
- Blue-hat health food: only use the approved function text provided by the user. Include a visible disclaimer direction: 本品為保健食品，不能代替藥物；具體功效以批准文號載明內容為準.
- Ordinary food: do not imply health, medical, symptom, body-change, disease, sleep, immunity, fat-loss, digestion, or treatment effects. Safe angles are ingredient/source, process, taste, nutrition facts with support, packaging, scene, SKU, brand story, and production qualification. Include a visible disclaimer direction: 本品為一般食品，非保健食品，非藥品；不具有任何保健功能或治療作用；僅供日常食用.
- Sports equipment/body-management: avoid medical diagnosis and treatment language such as 治療, 修復, 康復, 矯正, 腰痠背痛, 關節痛, 脊柱側彎, medical grade. Prefer 訓練, 體態管理, 支撐, 放鬆緊繃感, 輔助, 有助於, 因人而異, and include a visible non-medical disclaimer direction when claims are sensitive.

Prompt writing rules for ecommerce jobs:
- Include exact on-image copy only when it is safe. If the user provides draft copy that is risky, rewrite it into compliant, shorter copy.
- Preserve user-provided brand, SKU, price, and qualification text exactly enough to avoid changing facts. Do not fabricate brands, company names, approvals, badges, test reports, "official" seals, rankings, or prices.
- The visual prompt should tell the image model where text goes, hierarchy, layout, color mood, product placement, and mobile readability.
- For Chinese marketplace assets, prefer clean Chinese typography, high contrast, product-first composition, and uncluttered mobile scanning.
`;

export const ECOMMERCE_VISUAL_COPYWRITING_COMPLIANCE_RULES = `# 電商文案合規規則庫

按產品類型分層，使用時自動匹配對應規則層。一般食品紅線最嚴：什麼功能都不能說。

## 零層：通用規則（所有產品必過）

### 絕對化用語禁用清單
禁止：唯一、最、所有、只有、第一、絕對、頂級、極致、完美、無敵、徹底、完全、100%、99%、100倍、國家級、特效
替換為：多數 / 約 / 顯著 / 較為 / 之一 / 部分 / 大多數 / 助力 / 逐步

### 資料/事實宣稱必須有背書
- 每個"XX倍""XX%""未檢出""含有"必須附第三方檢測報告編號。
- 認證類宣稱必須附認證機構全稱和證書編號。
- 無報告支撐的資料，刪除或改為定性模糊描述，例如"含量較高""多數情況下"。

### 競品對比原則
- 不直接貶低競品品牌。
- 不做"我優他劣"的二元對立表述。
- 正確方式：陳述自身屬性，並引用行業公開資料做客觀參照。

### 各平臺審查重點
| 平臺 | 抓取重點 |
|------|---------|
| 淘寶/天貓 | 系統自動審核敏感詞；保健食品/特殊品類嚴 |
| 京東 | 參數頁必須與資質100%一致；功效宣稱零容忍 |
| 拼多多 | 價格絕對化（最低價/最便宜）抓極嚴 |
| 抖音小店 | 影片/直播口播同樣需要合規 |

## 一層：藍帽子保健食品（持有保健食品批准文號）

### 核心鐵律
只能宣傳批文批准的功能名稱，一個字都不能多、一個字都不能少。

操作方法：
1. 先確認該產品的批准功能原文。
2. 全文只允許出現該功能的標準表述。

### 功效邊界表
| 禁止宣稱類型 | 禁用詞舉例 | 正確做法 |
|-------------|-----------|---------|
| 美容/護膚 | 氣色、素顏、膚色、美容、養顏、祛痘、抗衰、嫩膚 | 全部刪除 |
| 控糖/降血糖 | 控糖友好、糖友可吃、降血糖、穩血糖 | 必須加註"不具有該功效+請諮詢醫生" |
| 上火/清熱 | 不上火、祛火、清熱、解毒 | 有檢測支撐可寫"部分消費者回饋因人而異"，否則刪除 |
| 免疫力相關 | 提高免疫力、增強免疫、改善睡眠 | 非批准功能全部禁止 |
| 減肥/體重 | 發胖、瘦身、減脂推薦 | 改為"無糖分負擔"，不關聯體重 |

### 必須保留的法律免責聲明
本品為保健食品，不能代替藥物。
不能代替藥物治療疾病。
具體功效以批准文號載明內容為準。

## 二層：運動器材/體態管理類（非醫療器械）

### 核心風險
極易觸碰醫療化暗示和治療效果承諾紅線，因為目標使用者本身就是有身體困擾的人群。

### 醫療化術語替換表（高風險，必須逐條檢查）
| 禁止類型 | 禁用詞舉例 | 替換方向 | 原因 |
|-----------|-------------|-----------|------|
| 痛感描述 | 腰痠背痛、脖子痛、關節痛 | 腰背不適、肩頸緊繃感 | "痛"屬病理症狀 |
| 醫學術語 | 骨盆前傾、脊柱側彎、椎間盤 | 骨盆形態不佳、背部線條不直 | 醫學術語暗示診斷 |
| 治療動詞 | 修復、治療、康復、矯正 | 體態管理、體態調整、鍛鍊、訓練 | 暗示能治疾病 |
| 效果承諾 | 恢復XX狀態、找回XX身體 | 向XX狀態靠近、改善目前狀況 | 絕對化效果承諾 |
| 專業宣稱 | 專業級、醫療級（無資質時） | 科學、系統、規範、嚴謹 | 無資質不可宣稱 |

### 效果弱化原則（強制）
- 所有效果相關表述必須加入弱化詞：助力 / 逐步 / 輔助 / 有助於 / 因人而異。
- 禁止："100%有效""徹底改善""一定見效"。
- 推薦："助力逐步改善""效果因人而異"。

### 免責聲明模板
本產品為運動器材/健身設備，非醫療產品。
無法治療疾病或病理問題。
體態改善/訓練效果因人而異。
建議在專業人員指導下使用。
如有身體不適請及時就醫。

## 三層：一般食品（非保健食品、非藥品，最嚴）

### 核心原則
保健品至少有批文可說功能，一般食品什麼功能都不能說。

### 四條底線（必須同時滿足）
1. 無違禁絕對化用語。
2. 無虛假宣傳風險，所有賣點可驗證。
3. 無不正當競爭風險，不貶低競品。
4. 無醫療化暗示，全程未關聯任何疾病、症狀或功效。

### 絕對不能做的事
| 禁止類型 | 示例 | 原因 |
|-----------|------|------|
| 功效暗示 | "喝走脹悶感""喝出好狀態""日常調理" | 暗示身體變化等於功效宣稱 |
| 症狀關聯 | 描述胃脹/便秘/失眠/疲勞後接產品 | 痛點加產品等於間接功效聯想 |
| 人群疾病綁定 | "適合糖尿病患者""三高人群" | 將產品與疾病人群綁定 |
| 身體變化承諾 | "喝了之後XX""堅持飲用能XX" | 效果承諾無依據 |
| 原料功效轉嫁 | "松花粉富含XX營養所以能XX" | 用原料成分暗示成品功效 |

### 安全表達白名單（只能說這些）
| 可以說 | 可以說 | 可以說 |
|-----------|-----------|-----------|
| 原料來源產地 | 工藝特點（水溶/速溶/無渣） | 口感風味描述 |
| 成分配料表 | 營養成分資料（需檢測報告） | 飲用場景/時機 |
| 包裝規格/便攜性 | 品牌故事/源頭把控 | 生產資質/衛生許可 |

### 備援聲明（必須保留）
本品為一般食品，非保健食品，非藥品。
不具有任何保健功能或治療作用。
僅供日常食用。

## 上線前檢查清單（全品類通用）

1. 全文搜尋絕對化禁用詞，零容忍。
2. 確認功效/功能宣稱與資質批准範圍一致，不多不少。
3. 確認每條資料/認證宣稱附有報告編號或來源。
4. 確認所有效果/改善類表述均有弱化詞。
5. 確認頁面底部有法律免責聲明且字號可辨識。
6. 確認不適宜人群/注意事項與資質檔案一致。
7. 備案材料齊全，包括資質批件、檢測報告、生產許可等。
8. 提交平臺預審，通過後再正式上線。
`;

export function createBuiltInPlanningSkillLibraryLoadout(): PlanningSkillLoadout {
  return {
    skills: [createCorePlanningSkill(), createEcommercePlanningSkill()]
  };
}

export function createCorePlanningSkill(): PlanningSkillLoadoutSkill {
  return {
    slug: "canvas-image-planning",
    name: "canvas-image-planning",
    version: CANVAS_IMAGE_PLANNING_SKILL_VERSION,
    required: true,
    triggerMode: "always",
    files: [
      {
        path: CANVAS_IMAGE_PLANNING_SKILL_PATH,
        content: CANVAS_IMAGE_PLANNING_SKILL
      }
    ]
  };
}

export function createEcommercePlanningSkill(): PlanningSkillLoadoutSkill {
  return {
    slug: "ecommerce-visual-copywriting",
    name: "ecommerce-visual-copywriting",
    version: ECOMMERCE_VISUAL_COPYWRITING_SKILL_VERSION,
    required: false,
    triggerMode: "auto",
    files: [
      {
        path: ECOMMERCE_VISUAL_COPYWRITING_SKILL_PATH,
        content: ECOMMERCE_VISUAL_COPYWRITING_SKILL
      },
      {
        path: ECOMMERCE_VISUAL_COPYWRITING_COMPLIANCE_RULES_PATH,
        content: ECOMMERCE_VISUAL_COPYWRITING_COMPLIANCE_RULES
      }
    ]
  };
}

export function createPlanningSkillFiles(
  now = new Date(),
  input?: PlanningSkillLoadout
): Record<string, FileData> {
  const timestamp = now.toISOString();
  const loadout = normalizePlanningSkillLoadout(input);
  const files: Record<string, FileData> = {};
  for (const skill of loadout.skills) {
    for (const file of skill.files) {
      files[file.path] = {
        content: file.content.split("\n"),
        created_at: timestamp,
        modified_at: timestamp
      };
    }
  }

  return files;
}

export function createPlanningSystemPrompt(input?: PlanningSkillLoadout): string {
  const loadout = normalizePlanningSkillLoadout(input);
  const requiredSkillVersions = loadout.skills
    .filter((skill) => skill.required)
    .map((skill) => skill.version || skill.name || skill.slug)
    .filter(Boolean)
    .join(", ");
  const optionalSkillVersions = loadout.skills
    .filter((skill) => !skill.required)
    .map((skill) => skill.version || skill.name || skill.slug)
    .filter(Boolean)
    .join(", ");
  const lines = [
    "You are the gpt-image-canvas planning agent.",
    `Required planning contract: ${requiredSkillVersions || CANVAS_IMAGE_PLANNING_SKILL_VERSION}.`,
    optionalSkillVersions
      ? `Additional Agent skills are available through the DeepAgents Skills System: ${optionalSkillVersions}. Match optional skills by their descriptions, read the relevant SKILL.md before using them, and ignore optional skills that do not fit the user request.`
      : "No optional Agent skills are active for this request.",
    "Your only task is to produce strict GenerationPlan JSON for the canvas.",
    "Use DeepAgents native tools only when they help read skills, memory, or isolated planning context.",
    "Do not expose filesystem, shell, database, or environment details.",
    "Return exactly one JSON object that follows the skill schema."
  ];

  if (loadout.skills.some((skill) => skill.slug === "ecommerce-visual-copywriting")) {
    lines.splice(
      3,
      0,
      `The ${ECOMMERCE_VISUAL_COPYWRITING_SKILL_VERSION} skill is available. Use it only when the request actually involves ecommerce, product listings, marketplace imagery, or advertising compliance.`
    );
  }

  return lines.join("\n");
}

function normalizePlanningSkillLoadout(input?: PlanningSkillLoadout): PlanningSkillLoadout {
  if (input && "skills" in input && Array.isArray(input.skills)) {
    return input;
  }

  return createBuiltInPlanningSkillLibraryLoadout();
}
