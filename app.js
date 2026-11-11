(() => {
  "use strict";

  const QUESTION_COUNT = 5;
  const PASS_RATE = 0.5;
  const COMPLETION_KEY = "jma-ai-appraisal-completed-v1";
  const GEM_META = window.gemQuestionMeta || {};

  const normalizeChoice = (question, choice, index) => {
    if (question.kind === "choice") {
      const match = choice.match(/^([A-D])[.．]\s*(.*)$/);
      return {
        key: match ? match[1] : String.fromCharCode(65 + index),
        label: match ? match[2] : choice,
      };
    }
    return { key: choice, label: choice };
  };

  const normalizeQuestion = (question) => {
    const answerKey =
      question.kind === "choice"
        ? question.answer.replace(/[.．].*$/, "").trim()
        : question.answer;
    return {
      ...question,
      answerKey,
      choices: question.choices.map((choice, index) =>
        normalizeChoice(question, choice, index),
      ),
      meta:
        GEM_META[question.id] || {
          gem: question.kind === "choice" ? "gem-mix" : "diamond",
          label: "寶石知識",
          topic: "寶石鑑賞",
        },
    };
  };

  const questions = (window.quizQuestions || []).map(normalizeQuestion);

  const state = {
    items: [],
    index: 0,
    score: 0,
    answered: false,
    selectedKey: null,
    results: [],
    setId: null,
    activeDialog: null,
    returnFocus: null,
  };

  const elements = {
    consent: document.querySelector("#consentCheck"),
    start: document.querySelector("#startQuiz"),
    completionNote: document.querySelector("#completionNote"),
    quizModal: document.querySelector("#quizModal"),
    quizDialog: document.querySelector("#quizModal .quiz-modal"),
    quizContent: document.querySelector("#quizContent"),
    qrModal: document.querySelector("#qrModal"),
    qrDialog: document.querySelector("#qrModal .qr-modal"),
  };

  function getQuestionSet(question) {
    return question.id <= 29 ? "A" : "B";
  }

  function getSetName(setId) {
    return setId === "A" ? "正誤題組" : "四選一題組";
  }

  function getSetDescription(setId) {
    return setId === "A"
      ? "第 1–29 題正誤題"
      : "第 30–50 題四選一題";
  }

  function shuffle(items) {
    const result = items.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
    }
    return result;
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function readCompletion() {
    try {
      return JSON.parse(localStorage.getItem(COMPLETION_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveCompletion(result) {
    try {
      localStorage.setItem(COMPLETION_KEY, JSON.stringify(result));
    } catch {
      // Local file privacy modes may block storage; the current session still works.
    }
  }

  function updateStartAvailability() {
    const completed = readCompletion();
    elements.consent.disabled = Boolean(completed);
    elements.start.disabled = Boolean(completed) || !elements.consent.checked;
    elements.completionNote.hidden = !completed;
    if (completed) {
      elements.start.firstChild.textContent = "此裝置已完成挑戰 ";
    } else {
      elements.start.firstChild.textContent = "開啟鑑賞挑戰 ";
    }
  }

  function openDialog(dialog, section) {
    state.activeDialog = dialog;
    state.returnFocus = document.activeElement;
    dialog.hidden = false;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => {
      const focusTarget = section.querySelector(
        "button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      focusTarget?.focus();
    });
  }

  function closeDialog(dialog) {
    if (!dialog || dialog.hidden) return;
    dialog.hidden = true;
    document.body.classList.remove("modal-open");
    if (state.activeDialog === dialog) {
      state.activeDialog = null;
      state.returnFocus?.focus();
      state.returnFocus = null;
    }
  }

  function closeActiveDialog() {
    closeDialog(state.activeDialog);
  }

  function startQuiz() {
    if (readCompletion()) {
      updateStartAvailability();
      return;
    }

    const requestedSet = new URLSearchParams(window.location.search)
      .get("set")
      ?.toUpperCase();
    state.setId =
      requestedSet === "A" || requestedSet === "B"
        ? requestedSet
        : Math.random() < 0.5
          ? "A"
          : "B";

    const pool = questions.filter(
      (question) => getQuestionSet(question) === state.setId,
    );
    state.items = shuffle(pool).slice(0, QUESTION_COUNT);
    state.index = 0;
    state.score = 0;
    state.answered = false;
    state.selectedKey = null;
    state.results = [];

    renderIntro();
    openDialog(elements.quizModal, elements.quizDialog);
  }

  function renderIntro() {
    elements.quizContent.replaceChildren();

    const intro = node("div", "quiz-intro");
    const heading = node("h2", "", "寶石鑑賞挑戰");
    heading.id = "quiz-title";
    intro.append(
      node("div", "quiz-kicker", "JMA GEM KNOWLEDGE · AI MENTOR"),
      heading,
      node(
        "p",
        "",
        `本局從${getSetDescription(state.setId)}隨機抽出 5 題，每題作答後即時顯示 AI 導師分析。`,
      ),
    );

    const rules = node("div", "quiz-rules");
    [
      ["01", "五題挑戰"],
      ["02", "AI 即時分析"],
      ["03", "禮物 A / B"],
    ].forEach(([number, label]) => {
      const rule = node("span");
      rule.append(node("b", "", number), document.createTextNode(label));
      rules.append(rule);
    });

    const beginButton = node("button", "primary begin-quiz", "開始答題 ↗");
    beginButton.type = "button";
    beginButton.addEventListener("click", renderQuestion);

    intro.append(rules, beginButton);
    elements.quizContent.append(intro);
  }

  function createGemArt(meta) {
    const art = node("div", `gem-visual gem-${meta.gem}`);
    art.setAttribute("aria-hidden", "true");
    art.append(node("span", "gem-core"), node("i", "gem-facet"));
    return art;
  }

  function renderQuestion() {
    const question = state.items[state.index];
    elements.quizContent.replaceChildren();

    const progressTop = node("div", "quiz-progress-top");
    progressTop.append(
      node(
        "span",
        "",
        `QUESTION ${String(state.index + 1).padStart(2, "0")} / ${String(
          QUESTION_COUNT,
        ).padStart(2, "0")}`,
      ),
      node("strong", "", `目前得分：${state.score} 分`),
    );

    const progress = node("div", "quiz-progress");
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", "答題進度");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", String(QUESTION_COUNT));
    progress.setAttribute("aria-valuenow", String(state.index));
    const progressBar = node("i");
    progressBar.style.width = `${(state.index / QUESTION_COUNT) * 100}%`;
    progress.append(progressBar);

    const questionHead = node("div", "question-head");
    const gemInfo = node("div", "gem-info");
    gemInfo.append(
      createGemArt(question.meta),
      node("span", "gem-label", question.meta.label),
    );
    questionHead.append(
      gemInfo,
      node("div", "quiz-number", `0${state.index + 1}`),
    );

    const questionHeading = node("h2", "quiz-question", question.question);
    questionHeading.id = "quiz-title";

    const options = node(
      "div",
      `quiz-options ${
        question.kind === "choice" ? "is-multiple-choice" : "is-boolean"
      }`,
    );
    question.choices.forEach((choice) => {
      const option = node(
        "button",
        `answer-option ${
          question.kind === "choice" ? "choice-option" : "boolean-option"
        }`,
      );
      option.type = "button";
      option.dataset.answer = choice.key;
      option.disabled = state.answered;

      if (question.kind === "choice") {
        option.append(
          node("span", "option-key", choice.key),
          node("span", "option-label", choice.label),
        );
      } else {
        option.textContent = choice.label;
      }

      if (state.answered) {
        if (choice.key === state.selectedKey) {
          option.classList.add(
            state.selectedKey === question.answerKey ? "is-correct" : "is-wrong",
          );
        }
        if (choice.key === question.answerKey) {
          option.classList.add("is-answer-key");
        }
      }

      option.addEventListener("click", () => answerQuestion(choice.key));
      options.append(option);
    });

    elements.quizContent.append(
      progressTop,
      progress,
      questionHead,
      questionHeading,
      options,
    );

    if (state.answered) {
      elements.quizContent.append(buildFeedback(question));
    } else {
      elements.quizContent.append(
        node(
          "p",
          "quiz-tip",
          question.kind === "choice"
            ? "請選擇 A、B、C 或 D；提交後會顯示 AI 導師分析"
            : "請選擇「正確」或「錯誤」；提交後會顯示 AI 導師分析",
        ),
      );
    }
  }

  function answerQuestion(choiceKey) {
    if (state.answered) return;
    const question = state.items[state.index];
    const isCorrect = choiceKey === question.answerKey;
    state.selectedKey = choiceKey;
    state.answered = true;
    if (isCorrect) state.score += 1;
    state.results.push({
      id: question.id,
      correct: isCorrect,
      topic: question.meta.topic,
      label: question.meta.label,
    });
    renderQuestion();
    elements.quizDialog.scrollTop = 0;
    elements.quizContent.querySelector(".answer-explanation")?.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }

  function getCorrectAnswerText(question) {
    const correct = question.choices.find(
      (choice) => choice.key === question.answerKey,
    );
    if (!correct) return question.answerKey;
    return question.kind === "choice"
      ? `${correct.key}. ${correct.label}`
      : correct.label;
  }

  function buildFeedback(question) {
    const isCorrect = state.selectedKey === question.answerKey;
    const feedback = node(
      "div",
      `answer-explanation ${isCorrect ? "is-correct" : "is-wrong"}`,
    );
    feedback.setAttribute("role", "status");
    feedback.append(
      node(
        "strong",
        "",
        `AI 導師分析 · ${
          isCorrect ? "回答正確" : "回答錯誤"
        } · 目前得分：${state.score} 分`,
      ),
      node("div", "correct-answer", `正確答案：${getCorrectAnswerText(question)}`),
      node(
        "p",
        "",
        question.explanation || "這道題的鑑賞重點已整理完成。",
      ),
    );

    const lastQuestion = state.index === state.items.length - 1;
    const nextButton = node(
      "button",
      "primary next-question",
      `${lastQuestion ? "查看 AI 分析報告" : "了解了，下一題"} →`,
    );
    nextButton.type = "button";
    nextButton.addEventListener("click", nextQuestion);
    feedback.append(nextButton);
    return feedback;
  }

  function nextQuestion() {
    if (state.index >= state.items.length - 1) {
      renderResult();
      elements.quizDialog.scrollTop = 0;
      return;
    }

    state.index += 1;
    state.answered = false;
    state.selectedKey = null;
    renderQuestion();
    elements.quizDialog.scrollTop = 0;
    elements.quizDialog.querySelector(".quiz-options button")?.focus();
  }

  function buildReport(score, missedTopics) {
    const base = {
      5: "五題全部答對，對本題組的寶石知識、材質與保養重點掌握完整。",
      4: "五題答對四題，核心概念掌握良好，只需補強本次唯一失分的知識點。",
      3: "本局達到 50% 禮物 A 門檻，已具備基礎辨識能力，建議繼續鞏固錯題概念。",
      2: "本局未達 50% 禮物 A 門檻，部分基礎概念仍需釐清，建議先複習本次錯題。",
      1: "本局未達 50% 禮物 A 門檻，建議從寶石種類、材質與保養三個方向重新建立基礎。",
      0: "本局未達 50% 禮物 A 門檻，建議先閱讀每題解析，再從寶石基礎知識開始學習。",
    }[score];

    if (missedTopics.length === 0) return base;
    return `${base} 建議優先複習：${missedTopics.join("、")}。`;
  }

  function renderResult() {
    const percentage = Math.round((state.score / QUESTION_COUNT) * 100);
    const conclusion = percentage >= PASS_RATE * 100 ? "A" : "B";
    const missedTopics = [
      ...new Set(
        state.results
          .filter((result) => !result.correct)
          .map((result) => result.topic),
      ),
    ];

    saveCompletion({
      score: state.score,
      percentage,
      conclusion,
      setId: state.setId,
      completedAt: new Date().toISOString(),
    });
    updateStartAvailability();

    elements.quizContent.replaceChildren();

    const result = node("div", "result report");
    const heading = node("h2", "", "AI 導師分析報告");
    heading.id = "quiz-title";

    const summary = node("div", "report-overview");
    const scoreRing = node("div", "score-ring");
    scoreRing.style.setProperty("--score-angle", `${percentage * 3.6}deg`);
    const scoreValue = node("div", "score-value");
    scoreValue.append(
      document.createTextNode(String(percentage)),
      node("small", "", "%"),
    );
    scoreRing.append(scoreValue, node("span", "", "正確率"));

    const summaryCopy = node("div", "report-summary");
    summaryCopy.append(
      node("div", `conclusion-pill conclusion-${conclusion.toLowerCase()}`, `結論 ${conclusion}`),
      node("strong", "", `${state.score} / ${QUESTION_COUNT} 題正確`),
      node("p", "", getSetDescription(state.setId)),
    );
    summary.append(scoreRing, summaryCopy);

    const metrics = node("div", "report-metrics");
    [
      ["答對題數", `${state.score} / ${QUESTION_COUNT}`],
      ["正確率", `${percentage}%`],
      ["禮物結論", `禮物 ${conclusion}`],
    ].forEach(([label, value]) => {
      const metric = node("div", "report-metric");
      metric.append(node("span", "", label), node("b", "", value));
      metrics.append(metric);
    });

    const analysis = node("div", "mentor-analysis");
    analysis.append(
      node("span", "", "AI 導師分析"),
      node("p", "", buildReport(state.score, missedTopics)),
    );

    const gift = node("div", `gift gift-${conclusion.toLowerCase()}`);
    gift.append(
      node("span", "", `CORRECT RATE ${percentage}% · CONCLUSION ${conclusion}`),
      node("b", "", `對應禮物 ${conclusion}`),
      node(
        "em",
        "",
        "請到登記處出示本頁，由工作人員核對後領取。",
      ),
    );

    const vote = node("div", "vote-note");
    vote.append(
      node("span", "", "IJDC VOTE"),
      node(
        "p",
        "",
        "領取禮物後，請別忘記參加 IJDC「最受公眾歡迎作品獎」投票。",
      ),
    );

    const actions = node("div", "result-actions");
    const finish = node("button", "primary finish-quiz", "完成");
    finish.type = "button";
    finish.addEventListener("click", closeActiveDialog);
    actions.append(finish);

    result.append(
      node("div", "quiz-kicker", "GEM APPRAISAL · AI MENTOR"),
      heading,
      summary,
      metrics,
      analysis,
      gift,
      vote,
      actions,
    );
    elements.quizContent.append(result);
    finish.focus();
  }

  function trapFocus(event) {
    if (event.key !== "Tab" || !state.activeDialog) return;
    const section = state.activeDialog.querySelector('[role="dialog"]');
    const focusable = Array.from(
      section.querySelectorAll(
        "button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    ).filter((element) => element.offsetParent !== null);

    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  elements.consent.addEventListener("change", updateStartAvailability);
  elements.start.addEventListener("click", startQuiz);

  document.querySelectorAll("[data-open-qr]").forEach((button) => {
    button.addEventListener("click", () => openDialog(elements.qrModal, elements.qrDialog));
  });

  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeDialog(backdrop);
    });
  });

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closeDialog(button.closest(".modal-backdrop"));
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeActiveDialog();
      return;
    }
    trapFocus(event);
  });

  updateStartAvailability();
})();
