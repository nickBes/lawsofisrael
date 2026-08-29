"""
prompts_v2.py
-------------
Custom LLooM prompts for the v2 / v2.1 experiment.

Two customised prompts live here:

1. A **free-form, context-rich summarize prompt** (``DISTILL_SUMMARIZE_PROMPT``,
   added in v2.1) that replaces LLooM's generic default summary. It produces
   concise, natural Hebrew *operative-rule* bullets that retain whatever
   materially distinguishing context is present (affected population, legal
   domain, actor, legal action/modality, object, exception, condition, time
   limit, or emergency context) instead of collapsing to generic legal verbs
   ("תיקון חוק", "הארכת תוקף", "זכות"). It is deliberately **not** a rigid
   schema: no required slots, no mandatory core-field template. It keeps the
   template fields LLooM's ``validate_prompt`` requires for the summarize step
   (``{ex}``, ``{seeding_phrase}``, ``{n_bullets}``, ``{n_words}``) and the
   parsed ``{"bullets": [...]}`` response shape.

2. A **compact, condition-faithful Hebrew synthesis prompt**
   (``SYNTHESIZE_PROMPT``) for the final cluster labels. The synthesis prompt
   below:

- Preserves the template fields LLooM's ``validate_prompt`` requires for the
  synthesize step (``{examples}``, ``{n_concepts_phrase}``, ``{seeding_phrase}``)
  and the exact ``patterns`` JSON response schema LLooM parses
  (list of ``{name, prompt, example_ids}``).
- Instructs the model to write a *compact Hebrew label* (``name``) describing
  the shared operative legal effect, retaining inline any material negation,
  exception, condition, temporal limit, emergency provision, or eligibility
  criterion that changes the legal meaning.
- Forbids unsupported statements of subjective policy purpose (labels describe
  the legal effect, not inferred legislative intent).
- Uses the ``prompt`` field as a short *internal inclusion criterion* consumed
  only by LLooM's review/selection stage - v2 never scores, so this criterion
  is not used to label documents.
- Requires ``example_ids`` to be drawn only from the supplied cluster examples.

The prompt is versioned and content-addressable so a run manifest can record
exactly which prompt produced a set of labels.
"""

from __future__ import annotations

import hashlib

# ===========================================================================
# Distill-summarize prompt (v2.1): free-form, context-rich operative-rule
# bullets. Replaces LLooM's generic default summarize prompt.
# ===========================================================================

# Bump when the summarize prompt text changes in a way that affects outputs.
# v2.1.1: exclude enactment/administrative boilerplate (signatures, official
# publication, formal receipt, standalone dates) from being emitted as bullets,
# and demote dates/section references to trailing qualifiers rather than the
# subject of a bullet - diagnostics showed boilerplate forming a spurious
# cluster and near-identical date-twin bullets dominating similarity.
# v2.1.2: strengthen the boilerplate exclusion (a leading hard rule + explicit
# "when/received in the Knesset on <date>" receipt pattern that still leaked),
# and fix an example typo. Boilerplate is still enforced by instruction only -
# no code-level filter yet.
DISTILL_SUMMARIZE_PROMPT_VERSION = "v2.1.2"

# Required template fields for the summarize step (mirrors LLooM's
# workbench.validate_prompt requirements) and the parsed response key.
DISTILL_SUMMARIZE_REQUIRED_FIELDS = ("ex", "seeding_phrase", "n_bullets", "n_words")
DISTILL_SUMMARIZE_RESPONSE_KEY = "bullets"

# NOTE: literal JSON braces are escaped ({{ }}) because this string is consumed
# by str.format with the fields above. ``{n_words}`` is kept in the contract for
# LLooM compatibility but the instructions intentionally treat it as a soft
# target, not a hard cap, so a bullet is never forced to drop a distinguishing
# qualifier just to hit a word count.
DISTILL_SUMMARIZE_PROMPT = """
I have the following TEXT EXAMPLE of Israeli legislative text (in Hebrew):
{ex}

Please summarize this EXAMPLE {seeding_phrase} into {n_bullets} bullet points.
Each bullet must describe exactly ONE atomic operative legal rule from the
EXAMPLE, written as a concise, natural Hebrew phrase (aim for about {n_words}
words, but prioritise being distinguishing over being short).

HARD RULE - read first: a bullet must state an OPERATIVE LEGAL RULE (something
the law grants, requires, prohibits, permits, extends, exempts, or establishes).
NEVER produce a bullet whose subject is a signature, an official publication, a
formal procedural/receipt fact, or a date/calendar reference. If a sentence in
the EXAMPLE is only such enactment/administrative housekeeping, SKIP it and emit
fewer bullets - it is better to return fewer bullets than to include boilerplate.

Write each bullet so it could be told apart from a superficially similar rule.
WHENEVER the text states them, keep the details that make the rule specific:
- to WHOM it applies (the affected population / beneficiary / regulated party);
- by WHOM it is done (the acting authority or actor), if named;
- WHAT legal action or change it makes (grants, requires, prohibits, permits,
  extends, exempts, establishes, amends);
- WHAT is regulated (the concrete object / subject-matter);
- WHERE / which legal domain it sits in, if that distinguishes it;
- under WHAT exception, condition, timeframe, or emergency context
  (e.g. "למעט", "בכפוף ל", "ובלבד ש", "הוראת שעה", "בשעת חירום", "עד <תאריך>").
PRESERVE negation, conditions, and exceptions exactly - do not drop a qualifier
that changes the legal meaning.

Do NOT emit a bullet that is only a generic legal verb or boilerplate when the
source supports something more specific. In particular AVOID bare bullets like
"תיקון חוק", "קביעת הוראות", "הארכת תוקף", "מתן סמכות", or a lone "זכות":
attach the distinguishing context instead (e.g. prefer
"הארכת סמכות כליאה בחירום לאסירי ביטחון עד ספטמבר 2026" over "הארכת תוקף").

DO NOT emit bullets for ENACTMENT OR ADMINISTRATIVE BOILERPLATE - these are not
operative legal rules and must be omitted entirely, including:
- signatures and who signed/holds office
  (e.g. "חתימת ... כנשיא המדינה", "... כיושב ראש הכנסת");
- official publication or promulgation
  (e.g. "פרסום ספר החוקים הרשמי", "פורסם ברשומות");
- formal legislative procedure/receipt, INCLUDING the date a law was passed or
  received in the Knesset
  (e.g. "קבלה רשמית בכנסת", "התקבל בקריאה שלישית",
   "מועד קבלת חוק זה בכנסת הוא ...", "התקבל בכנסת ביום ...");
- a bare date or calendar reference on its own
  (e.g. "ציון התאריך הלועזי 28 ביולי 2028", a lone Hebrew/Gregorian date).

Treat DATES, EXPIRY/EFFECTIVE MOMENTS, and SECTION/LAW REFERENCES as SECONDARY
QUALIFIERS, never as the subject of a bullet. Lead with the operative content
(what is changed and for whom/what), then append the date/reference as a
trailing qualifier. Do NOT emit two near-identical bullets that differ only in a
date; describe the operative change once with its relevant time limit.
(e.g. prefer "הארכת תוקף הכרזת מצב חירום בבתי הסוהר עד תשרי התשפ\\"ז" over
"החלפת מועד תפוגה ליום כ\\"ג בשבט התשפ\\"ז".)

Do NOT invent details that are not in the EXAMPLE, and do NOT assert legislative
motive or purpose that is not explicitly stated. Describe the legal EFFECT.

Please respond ONLY with a valid JSON in the following format:
{{
    "bullets": [ "<BULLET_1>", "<BULLET_2>", ... ]
}}
"""


def distill_summarize_prompt_hash(prompt: str = DISTILL_SUMMARIZE_PROMPT) -> str:
    """Stable short content hash (sha256, first 12 hex) of the summarize prompt."""
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12]


def distill_summarize_prompt_info(prompt: str = DISTILL_SUMMARIZE_PROMPT) -> dict:
    """Manifest-ready descriptor of the active summarize prompt."""
    return {
        "summarize_prompt_version": DISTILL_SUMMARIZE_PROMPT_VERSION,
        "summarize_prompt_hash": distill_summarize_prompt_hash(prompt),
    }


def validate_summarize_prompt(prompt: str = DISTILL_SUMMARIZE_PROMPT) -> str:
    """Validate that ``prompt`` keeps LLooM's required fields and response key.

    Mirrors LLooM's ``validate_prompt`` check for the summarize step and also
    requires the ``bullets`` response key. Returns the prompt unchanged if valid.
    """
    for field in DISTILL_SUMMARIZE_REQUIRED_FIELDS:
        if f"{{{field}}}" not in prompt:
            raise ValueError(
                f"v2.1 summarize prompt missing required field: {{{field}}}"
            )
    if DISTILL_SUMMARIZE_RESPONSE_KEY not in prompt:
        raise ValueError(
            f"v2.1 summarize prompt missing response key: {DISTILL_SUMMARIZE_RESPONSE_KEY!r}"
        )
    return prompt


def format_summarize_prompt(ex: str, n_bullets="2-4", n_words="5-8",
                            seeding_phrase: str = "") -> str:
    """Fill the summarize prompt fields (for inspection / offline testing)."""
    return DISTILL_SUMMARIZE_PROMPT.format(
        ex=ex, seeding_phrase=seeding_phrase, n_bullets=n_bullets, n_words=n_words,
    )


# ===========================================================================
# Synthesize prompt (v2.0): compact, condition-faithful Hebrew cluster labels.
# ===========================================================================

# Bump when the synthesis prompt text changes in a way that affects outputs.
SYNTHESIZE_PROMPT_VERSION = "v2.0.0"

# Required template fields for the synthesize step (mirrors LLooM's
# workbench.validate_prompt requirements) and the parsed response schema key.
SYNTHESIZE_REQUIRED_FIELDS = ("examples", "n_concepts_phrase", "seeding_phrase")
SYNTHESIZE_RESPONSE_KEY = "patterns"

# NOTE: literal JSON braces are escaped ({{ }}) because this string is consumed
# by str.format with the fields above.
SYNTHESIZE_PROMPT = """
I have this set of bullet-point summaries of Israeli legislative text examples (in Hebrew):
{examples}

Please identify {n_concepts_phrase}. {seeding_phrase} Each pattern is a SHARED OPERATIVE LEGAL RULE that recurs across the examples.

For EACH pattern, produce:
1. A COMPACT HEBREW LABEL ("name"), typically 3-8 words, that states the shared operative legal effect (what the law requires, prohibits, permits, or establishes). The label MUST retain, INLINE, any qualification that materially changes the legal meaning, including:
   - negation ("לא", "אין", "אלא");
   - exceptions and carve-outs ("למעט", "פרט ל", "אלא אם כן");
   - conditions ("בכפוף ל", "ובלבד ש", "רק אם", "אם");
   - temporal limits and emergency/temporary provisions ("הוראת שעה", "לתקופה", "בשעת חירום");
   - eligibility or applicability criteria (who/what it applies to).
   Do NOT drop a material qualifier to make the label shorter. Omit only boilerplate that does not change the operative meaning.
2. Do NOT assert any subjective policy purpose, motive, or legislative intent that is not explicitly stated in the examples. Describe the legal EFFECT, not the presumed goal.
3. A short INTERNAL INCLUSION CRITERION ("prompt"): a 1-sentence Hebrew test of whether a new legislative excerpt expresses this same operative rule together with its material qualifications. This criterion is used only for grouping/review.
4. 1-2 "example_ids" drawn ONLY from the example ids supplied above, for the items that BEST exemplify the pattern.

Guidance by qualifier type (illustrative):
- Prohibited conduct: keep the prohibition explicit, e.g. "איסור אספקת תוכן תועבה, למעט תוכן בעל ערך אמנותי/חדשותי".
- Carve-outs: keep the exception, e.g. "חובת רישום במרשם, למעט ספק שהכנסתו נמוכה מהסף".
- Temporary provisions: keep the time limit, e.g. "חובת העברת ערוצים כהוראת שעה לחמש שנים".
- Conditional eligibility: keep the condition, e.g. "פטור מחובת השקעה בכפוף לאישור המועצה".

Please respond ONLY with a valid JSON in the following format:
{{
    "patterns": [
        {{"name": "<HEBREW_LABEL_1>", "prompt": "<INTERNAL_CRITERION_1>", "example_ids": ["<EXAMPLE_ID_1>", "<EXAMPLE_ID_2>"]}},
        {{"name": "<HEBREW_LABEL_2>", "prompt": "<INTERNAL_CRITERION_2>", "example_ids": ["<EXAMPLE_ID_1>", "<EXAMPLE_ID_2>"]}}
    ]
}}
"""


def prompt_hash(prompt: str = SYNTHESIZE_PROMPT) -> str:
    """Stable short content hash (sha256, first 12 hex chars) of ``prompt``.

    Used in the v2 run manifest so a set of labels can be traced to the exact
    prompt text that produced them, independent of the human-readable version.
    """
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12]


def synthesize_prompt_info(prompt: str = SYNTHESIZE_PROMPT) -> dict:
    """Manifest-ready descriptor of the active synthesis prompt."""
    return {
        "synthesize_prompt_version": SYNTHESIZE_PROMPT_VERSION,
        "synthesize_prompt_hash": prompt_hash(prompt),
    }


def prompt_info(
    summarize_prompt: str = DISTILL_SUMMARIZE_PROMPT,
    synthesize_prompt: str = SYNTHESIZE_PROMPT,
) -> dict:
    """Combined manifest descriptor for both customised v2.1 prompts.

    Records the version and content hash of the free-form summarize prompt and
    the condition-faithful synthesis prompt so a run's bullets and labels are
    both traceable to the exact prompt text that produced them.
    """
    info = distill_summarize_prompt_info(summarize_prompt)
    info.update(synthesize_prompt_info(synthesize_prompt))
    return info


def validate_synthesize_prompt(prompt: str = SYNTHESIZE_PROMPT) -> str:
    """Validate that ``prompt`` keeps LLooM's required fields and response key.

    Mirrors LLooM's own ``validate_prompt`` check for the synthesize step (so a
    mismatch is caught before a run) and additionally requires the ``patterns``
    response key to be present. Returns the prompt unchanged if valid.
    """
    for field in SYNTHESIZE_REQUIRED_FIELDS:
        if f"{{{field}}}" not in prompt:
            raise ValueError(
                f"v2 synthesize prompt missing required field: {{{field}}}"
            )
    if SYNTHESIZE_RESPONSE_KEY not in prompt:
        raise ValueError(
            f"v2 synthesize prompt missing response key: {SYNTHESIZE_RESPONSE_KEY!r}"
        )
    return prompt


def format_synthesize_prompt(examples: str, n_concepts_phrase: str,
                            seeding_phrase: str = "") -> str:
    """Fill the synthesis prompt fields (for inspection / offline testing)."""
    return SYNTHESIZE_PROMPT.format(
        examples=examples,
        n_concepts_phrase=n_concepts_phrase,
        seeding_phrase=seeding_phrase,
    )


def validate_synthesis_result(patterns: list[dict], cluster_example_ids: set) -> list[dict]:
    """Validate a parsed ``patterns`` synthesis result against a cluster.

    Checks each pattern has ``name``/``prompt``/``example_ids`` and that every
    referenced example id belongs to ``cluster_example_ids`` (LLooM synthesizes
    per cluster, so representative ids must come from that cluster's examples).
    Returns the patterns unchanged if valid; raises ``ValueError`` otherwise.
    """
    cluster_ids = {str(x) for x in cluster_example_ids}
    for i, p in enumerate(patterns):
        for key in ("name", "prompt", "example_ids"):
            if key not in p:
                raise ValueError(f"pattern {i} missing key: {key!r}")
        for ex_id in p["example_ids"]:
            if str(ex_id) not in cluster_ids:
                raise ValueError(
                    f"pattern {i} references example_id {ex_id!r} not in its cluster"
                )
    return patterns


def make_custom_prompts(session) -> dict:
    """Build the ``custom_prompts`` dict for ``session.gen`` in v2.1.

    Supplies LLooM's *installed default* filter (quote extraction) prompt
    unchanged, the v2.1 free-form context-rich **summarize** prompt, and the
    v2 condition-faithful **synthesize** prompt. Only quote filtering is left
    at the default; both the pre-clustering bullets and the final labels are
    customised.
    """
    return {
        "distill_filter": session.show_prompt("distill_filter"),
        "distill_summarize": validate_summarize_prompt(DISTILL_SUMMARIZE_PROMPT),
        "synthesize": validate_synthesize_prompt(SYNTHESIZE_PROMPT),
    }
