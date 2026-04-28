(() => {
  const bank = window.TAXI_QUESTION_BANK;
  const required = bank?.paperRules || { trueFalse: 25, choice: 25 };
  const typeNames = {
    trueFalse: "是非題",
    choice: "選擇題",
  };

  const state = {
    paper: [],
    answers: new Map(),
    submitted: false,
    missedOnly: false,
    config: {
      subject: "traffic_law",
      region: "",
    },
  };

  const $ = (selector) => document.querySelector(selector);
  const els = {
    totalQuestions: $("#totalQuestions"),
    sourceSummary: $("#sourceSummary"),
    setupPanel: $("#setupPanel"),
    regionBlock: $("#regionBlock"),
    regionSelect: $("#regionSelect"),
    poolCounts: $("#poolCounts"),
    startExamBtn: $("#startExamBtn"),
    examPanel: $("#examPanel"),
    examTitle: $("#exam-title"),
    examMeta: $("#examMeta"),
    questionsList: $("#questionsList"),
    progressText: $("#progressText"),
    progressBar: $("#progressBar"),
    submitExamBtn: $("#submitExamBtn"),
    backToSetupBtn: $("#backToSetupBtn"),
    resultPanel: $("#resultPanel"),
    resultSummary: $("#resultSummary"),
    toggleMissedBtn: $("#toggleMissedBtn"),
    printBtn: $("#printBtn"),
    newExamBtn: $("#newExamBtn"),
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function init() {
    if (!bank?.questions?.length) {
      document.body.innerHTML = "<main class=\"shell\"><section class=\"setup-card\">題庫載入失敗，請先執行 python scripts/build_question_bank.py。</section></main>";
      return;
    }

    hydrateStats();
    hydrateRegions();
    restoreSettings();
    bindEvents();
    syncControls();
    updatePoolCounts();
  }

  function hydrateStats() {
    els.totalQuestions.textContent = bank.questions.length.toLocaleString("zh-Hant");
    els.sourceSummary.textContent = `${bank.sources.length} 份 PDF，${bank.regions.length} 個地理環境縣市`;
  }

  function hydrateRegions() {
    els.regionSelect.innerHTML = bank.regions
      .map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`)
      .join("");
    state.config.region = bank.regions[0] || "";
  }

  function restoreSettings() {
    const savedSubject = localStorage.getItem("taxiQuiz.subject");
    const savedRegion = localStorage.getItem("taxiQuiz.region");

    if (savedSubject && ["traffic_law", "geography"].includes(savedSubject)) {
      state.config.subject = savedSubject;
    }
    if (savedRegion && bank.regions.includes(savedRegion)) {
      state.config.region = savedRegion;
    }
  }

  function bindEvents() {
    document.querySelectorAll("input[name='subject']").forEach((input) => {
      input.addEventListener("change", () => {
        state.config.subject = getSelectedSubject();
        persistSettings();
        syncControls();
        updatePoolCounts();
      });
    });

    els.regionSelect.addEventListener("change", () => {
      state.config.region = els.regionSelect.value;
      persistSettings();
      updatePoolCounts();
    });

    els.startExamBtn.addEventListener("click", startExam);
    els.newExamBtn.addEventListener("click", startExam);
    els.backToSetupBtn.addEventListener("click", showSetup);
    els.printBtn.addEventListener("click", () => window.print());
    els.toggleMissedBtn.addEventListener("click", () => {
      state.missedOnly = !state.missedOnly;
      renderPaper();
      renderResults();
    });
    els.submitExamBtn.addEventListener("click", submitExam);

    els.questionsList.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "radio") {
        return;
      }
      state.answers.set(input.dataset.questionId, input.value);
      updateProgress();
    });
  }

  function persistSettings() {
    localStorage.setItem("taxiQuiz.subject", state.config.subject);
    localStorage.setItem("taxiQuiz.region", state.config.region);
  }

  function getSelectedSubject() {
    return document.querySelector("input[name='subject']:checked").value;
  }

  function syncControls() {
    document.querySelectorAll("input[name='subject']").forEach((input) => {
      input.checked = input.value === state.config.subject;
    });

    els.regionSelect.value = state.config.region;
    const usesRegion = state.config.subject === "geography";
    els.regionSelect.disabled = !usesRegion;
    els.regionBlock.classList.toggle("is-disabled", !usesRegion);
  }

  function getPools() {
    const subject = state.config.subject;
    const region = state.config.region;
    const selected = bank.questions.filter((question) => {
      if (question.subject !== subject) {
        return false;
      }
      return subject !== "geography" || question.region === region;
    });

    return {
      trueFalse: selected.filter((question) => question.type === "trueFalse"),
      choice: selected.filter((question) => question.type === "choice"),
    };
  }

  function updatePoolCounts() {
    const pools = getPools();
    const enoughTrueFalse = pools.trueFalse.length >= required.trueFalse;
    const enoughChoice = pools.choice.length >= required.choice;
    els.poolCounts.textContent = `是非 ${pools.trueFalse.length} 題 / 選擇 ${pools.choice.length} 題`;
    els.startExamBtn.disabled = !(enoughTrueFalse && enoughChoice);
  }

  function startExam() {
    const pools = getPools();
    if (pools.trueFalse.length < required.trueFalse || pools.choice.length < required.choice) {
      window.alert("目前題庫不足以建立 25 題是非題與 25 題選擇題的考卷。");
      return;
    }

    const trueFalseQuestions = sample(pools.trueFalse, required.trueFalse).map((question, index) => ({
      ...question,
      paperIndex: index + 1,
      sectionIndex: index + 1,
    }));
    const choiceQuestions = sample(pools.choice, required.choice).map((question, index) => ({
      ...question,
      paperIndex: required.trueFalse + index + 1,
      sectionIndex: index + 1,
    }));

    state.paper = [...trueFalseQuestions, ...choiceQuestions];
    state.answers = new Map();
    state.submitted = false;
    state.missedOnly = false;

    els.setupPanel.hidden = true;
    els.examPanel.hidden = false;
    els.resultPanel.hidden = true;
    els.submitExamBtn.disabled = true;
    els.toggleMissedBtn.textContent = "只看錯題";

    renderPaper();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function sample(items, count) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy.slice(0, count);
  }

  function renderPaper() {
    const title = state.config.subject === "geography" ? `${state.config.region}地理環境` : "交通法令";
    els.examTitle.textContent = `${title}模擬測驗`;
    els.examMeta.textContent = `是非題 ${required.trueFalse} 題 + 選擇題 ${required.choice} 題，共 ${state.paper.length} 題`;

    let currentType = "";
    els.questionsList.innerHTML = state.paper
      .map((question) => {
        const divider =
          question.type !== currentType
            ? `<div class="section-divider">${escapeHtml(typeNames[question.type])}</div>`
            : "";
        currentType = question.type;
        return divider + renderQuestion(question);
      })
      .join("");

    updateProgress();
  }

  function renderQuestion(question) {
    const selected = state.answers.get(question.id);
    const isCorrect = state.submitted && selected === question.answer;
    const isWrong = state.submitted && selected && selected !== question.answer;
    const isMissing = state.submitted && !selected;
    const isFiltered = state.submitted && state.missedOnly && isCorrect;
    const statusClass = [
      isCorrect ? "is-correct" : "",
      isWrong ? "is-wrong" : "",
      isMissing ? "is-missing" : "",
      isFiltered ? "is-filtered" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const options = getOptions(question);
    const source = state.submitted
      ? `<div class="question-source">來源：${escapeHtml(question.sourceFile)} #${escapeHtml(question.number)}<br>更新：${escapeHtml(question.updated)}</div>`
      : "";

    return `
      <article class="question-card ${statusClass}" id="question-${question.paperIndex}">
        <div class="question-head">
          <span class="question-number">${question.paperIndex}. ${typeNames[question.type]} ${question.sectionIndex}</span>
          ${source}
        </div>
        <p class="question-text">${escapeHtml(question.text)}</p>
        <div class="options">
          ${options.map((option) => renderOption(question, option, selected)).join("")}
        </div>
        ${state.submitted ? renderAnswerNote(question, selected) : ""}
      </article>
    `;
  }

  function getOptions(question) {
    if (question.type === "trueFalse") {
      return [
        { label: "是", text: "是" },
        { label: "否", text: "否" },
      ];
    }
    return question.options;
  }

  function renderOption(question, option, selected) {
    const inputId = `q-${question.paperIndex}-${option.label}`;
    const isSelected = selected === option.label;
    const isAnswer = state.submitted && option.label === question.answer;
    const isWrongChoice = state.submitted && isSelected && option.label !== question.answer;
    const className = [
      "option",
      isSelected ? "is-selected" : "",
      isAnswer ? "is-answer" : "",
      isWrongChoice ? "is-wrong-choice" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return `
      <label class="${className}" for="${escapeHtml(inputId)}">
        <input
          id="${escapeHtml(inputId)}"
          type="radio"
          name="answer-${question.paperIndex}"
          value="${escapeHtml(option.label)}"
          data-question-id="${escapeHtml(question.id)}"
          ${isSelected ? "checked" : ""}
          ${state.submitted ? "disabled" : ""}
        >
        <span class="option__key">${escapeHtml(option.label)}</span>
        <span>${escapeHtml(option.text)}</span>
      </label>
    `;
  }

  function renderAnswerNote(question, selected) {
    const correct = selected === question.answer;
    const answerText = getAnswerText(question);
    if (correct) {
      return `<p class="answer-note is-correct">答對。正確答案：${escapeHtml(answerText)}</p>`;
    }
    const userAnswer = selected ? getAnswerText(question, selected) : "未作答";
    return `<p class="answer-note is-wrong">答錯。你的答案：${escapeHtml(userAnswer)}；正確答案：${escapeHtml(answerText)}</p>`;
  }

  function getAnswerText(question, value = question.answer) {
    if (question.type === "trueFalse") {
      return value;
    }
    const option = question.options.find((item) => item.label === value);
    return option ? `${option.label}. ${option.text}` : value;
  }

  function updateProgress() {
    const total = state.paper.length;
    const answered = state.paper.filter((question) => state.answers.has(question.id)).length;
    const percent = total ? Math.round((answered / total) * 100) : 0;
    els.progressText.textContent = `${answered} / ${total}`;
    els.progressBar.style.width = `${percent}%`;
    els.submitExamBtn.disabled = state.submitted || answered < total;
  }

  function submitExam() {
    const unanswered = state.paper.length - state.answers.size;
    if (unanswered > 0) {
      window.alert(`還有 ${unanswered} 題尚未作答。`);
      return;
    }

    state.submitted = true;
    state.missedOnly = false;
    renderPaper();
    renderResults();
    els.resultPanel.hidden = false;
    els.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function calculateResults() {
    const byType = {
      trueFalse: { correct: 0, total: 0 },
      choice: { correct: 0, total: 0 },
    };
    let correct = 0;

    state.paper.forEach((question) => {
      byType[question.type].total += 1;
      if (state.answers.get(question.id) === question.answer) {
        correct += 1;
        byType[question.type].correct += 1;
      }
    });

    return {
      correct,
      total: state.paper.length,
      byType,
      score: Math.round((correct / state.paper.length) * 100),
    };
  }

  function renderResults() {
    const result = calculateResults();
    const title = state.config.subject === "geography" ? `${state.config.region}地理環境` : "交通法令";
    els.toggleMissedBtn.textContent = state.missedOnly ? "顯示全部題目" : "只看錯題";
    els.resultSummary.innerHTML = `
      <div class="score-line">
        <div>
          <p class="eyebrow">Result</p>
          <h2>${escapeHtml(title)}成績</h2>
          <p class="exam-meta">共 ${result.total} 題，答對 ${result.correct} 題，答錯 ${result.total - result.correct} 題。</p>
        </div>
        <p class="score-number">${result.score}<span>分</span></p>
      </div>
      <div class="score-grid">
        <div class="score-item">總答對<strong>${result.correct} / ${result.total}</strong></div>
        <div class="score-item">是非題<strong>${result.byType.trueFalse.correct} / ${result.byType.trueFalse.total}</strong></div>
        <div class="score-item">選擇題<strong>${result.byType.choice.correct} / ${result.byType.choice.total}</strong></div>
      </div>
    `;
  }

  function showSetup() {
    els.setupPanel.hidden = false;
    els.examPanel.hidden = true;
    els.resultPanel.hidden = true;
    updatePoolCounts();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  init();
})();
