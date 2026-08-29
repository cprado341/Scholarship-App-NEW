(function () {
  const MESSAGE_TYPE = "SCHOLARSHIP_AGENT_FILL";

  if (globalThis.scholarshipAgentAutofillInstalled) return;
  globalThis.scholarshipAgentAutofillInstalled = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPE) return false;
    try {
      const result = fillScholarshipAgentPlan(message.payload || {});
      sendResponse(result);
    } catch (error) {
      sendResponse({
        status: "failed",
        message: error.message || "Autofill failed.",
        filledFields: [],
        skippedFields: [],
        blockers: []
      });
    }
    return true;
  });

  function fillScholarshipAgentPlan(handoff) {
    const fillPlan = handoff.fillPlan || {};
    const session = fillPlan.submissionSession || {};
    const plan = fillPlan.applicationPlan || {};
    const rawSteps = Array.isArray(session.steps) ? session.steps : Array.isArray(plan.browserSteps) ? plan.browserSteps : [];
    const steps = augmentFillSteps(rawSteps, plan.fieldMap || {});
    const pageState = inspectPageState();

    if (pageState.loginRequired) {
      return {
        status: "waiting_for_login",
        message: "Login is required. Sign in on the scholarship site, then use Fill active tab.",
        filledFields: [],
        skippedFields: [],
        blockers: pageState.blockers
      };
    }

    if (pageState.blockers.length) {
      return {
        status: "waiting_for_manual_review",
        message: "Sensitive payment, signature, or recommendation language was detected. Review this page before continuing.",
        filledFields: [],
        skippedFields: [],
        blockers: pageState.blockers
      };
    }

    const filledFields = [];
    const skippedFields = [];
    for (const step of steps) {
      if (step.action === "navigate") continue;
      if (step.action === "stop_for_review") {
        skippedFields.push(`${step.selector || "submit"}: final submit remains manual`);
        continue;
      }
      if (step.action === "upload") {
        skippedFields.push(`${step.selector || "file upload"}: upload manually from Student Files`);
        continue;
      }
      if (step.action !== "fill") continue;
      const result = fillStep(step);
      if (result.ok) filledFields.push(result.label);
      else skippedFields.push(result.label);
    }

    const finalState = inspectPageState();
    const hasPageMissingFields = skippedFields.some((field) => /not on this page yet/i.test(field));
    return {
      status: finalState.reviewReady || finalState.blockers.length ? "waiting_for_manual_submit" : "filled",
      message: finalState.reviewReady
        ? "Known fields were filled. Review the page and submit manually."
        : hasPageMissingFields
          ? "Known fields were filled. Some profile fields are not on this page yet; continue to the next step, then use Fill active tab again."
        : "Known fields were filled. Check skipped fields before submitting manually.",
      filledFields,
      skippedFields,
      blockers: finalState.blockers
    };
  }

  function fillStep(step) {
    const field = findField(step);
    if (!field) return { ok: false, label: `${stepLabel(step)}: not on this page yet` };
    if (isUnsafeField(field)) return { ok: false, label: `${stepLabel(step, field)}: unsafe field type skipped` };
    if (isAttestationControl(field)) return { ok: false, label: `${stepLabel(step, field)}: attestation control left for manual review` };
    field.scrollIntoView({ block: "center", inline: "nearest" });
    field.focus();
    const tag = field.tagName.toLowerCase();
    const type = String(field.getAttribute("type") || "").toLowerCase();
    if (tag === "select") fillSelect(field, step.value);
    else if (type === "checkbox") field.checked = checkboxValue(step.value);
    else if (type === "radio") fillRadio(field, step.value);
    else setNativeValue(field, String(step.value || ""));
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, label: stepLabel(step, field) };
  }

  function fillSelect(select, value) {
    const normalized = normalize(value);
    const options = Array.from(select.options || []);
    const match = options.find((option) => normalize(option.value) === normalized || normalize(option.textContent) === normalized);
    setNativeValue(select, match ? match.value : String(value || ""));
  }

  function fillRadio(field, value) {
    const targetValue = String(value || "");
    const group = field.name
      ? document.querySelector(`input[type="radio"][name="${cssEscape(field.name)}"][value="${cssEscape(targetValue)}"]`)
      : null;
    if (group && !isUnsafeField(group)) group.checked = true;
    else field.checked = checkboxValue(value);
  }

  function checkboxValue(value) {
    return /^(true|yes|1|on|checked)$/i.test(String(value || ""));
  }

  function setNativeValue(field, value) {
    if (field.isContentEditable) {
      field.textContent = value;
      return;
    }
    const prototype = Object.getPrototypeOf(field);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(field, value);
    else field.value = value;
  }

  function findField(step) {
    const selectors = [step.selector, ...(Array.isArray(step.aliases) ? step.aliases : [])].filter(Boolean);
    const direct = selectors
      .map((selector) => safeQuerySelector(selector))
      .find((field) => field && !isUnsafeField(field) && isCompatibleFieldForStep(field, step));
    if (direct && !isUnsafeField(direct)) return direct;
    const keys = fieldKeys(step);
    if (!keys.length) return null;
    const candidates = Array.from(document.querySelectorAll("input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox']"))
      .filter((field) => !isUnsafeField(field))
      .filter((field) => isCompatibleFieldForStep(field, step));
    const scored = candidates
      .map((field) => ({ field, score: Math.max(...keys.map((key) => scoreField(field, key))) }))
      .filter((entry) => entry.score >= 6)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) return null;
    if (scored.length > 1 && scored[0].score === scored[1].score) return null;
    return scored[0].field;
  }

  function scoreField(field, key) {
    const normalizedKey = normalize(key);
    const signals = fieldSignals(field);
    if (signals.name === normalizedKey || signals.id === normalizedKey) return 12;
    if (signals.name.includes(normalizedKey) || signals.id.includes(normalizedKey)) return 10;
    const synonyms = fieldSynonyms(normalizedKey);
    let best = 0;
    for (const signal of Object.values(signals)) {
      for (const synonym of synonyms) {
        if (signal === synonym) best = Math.max(best, 9);
        else if (signal.includes(synonym)) best = Math.max(best, 7);
      }
    }
    const type = String(field.getAttribute("type") || "").toLowerCase();
    if (normalizedKey.includes("email") && type === "email") best = Math.max(best, 6);
    if (normalizedKey.includes("year") && /\b(yyyy|select year|year)\b/.test(Object.values(signals).join(" "))) best = Math.max(best, 8);
    if (normalizedKey.includes("major") && /\b(search majors|majors)\b/.test(Object.values(signals).join(" "))) best = Math.max(best, 8);
    if (normalizedKey.includes("college") && /\b(add a college|search college|college)\b/.test(Object.values(signals).join(" "))) best = Math.max(best, 8);
    return best;
  }

  function isCompatibleFieldForStep(field, step) {
    const type = String(field.getAttribute("type") || "").toLowerCase();
    if (type !== "checkbox" && type !== "radio") return true;
    const key = fieldKeys(step).join(" ");
    return /\b(firstgeneration|first_generation)\b/.test(key) || /^(true|false|yes|no|1|0)$/i.test(String(step.value || ""));
  }

  function fieldSignals(field) {
    return {
      name: normalize(field.getAttribute("name")),
      id: normalize(field.id),
      placeholder: normalize(field.getAttribute("placeholder")),
      aria: normalize(field.getAttribute("aria-label")),
      autocomplete: normalize(field.getAttribute("autocomplete")),
      label: normalize(labelText(field)),
      nearby: normalize(nearbyText(field))
    };
  }

  function fieldSynonyms(key) {
    const compactKey = String(key || "").replace(/\s+/g, "");
    const map = {
      studentname: ["student name", "applicant name", "legal name", "full name", "name"],
      preferredname: ["preferred name", "first name"],
      studentemail: ["student email", "applicant email", "email address", "email"],
      confirmationemail: ["confirmation email", "student email", "email address", "email"],
      gender: ["gender"],
      dateofbirth: ["date of birth", "birth date", "dob"],
      birthmonth: ["birth month", "dob month", "date of birth month"],
      birthday: ["birth day", "dob day", "date of birth day"],
      birthyear: ["birth year", "dob year", "date of birth year"],
      firstgeneration: ["first generation", "first generation college student", "first gen"],
      graduationmonth: ["graduation month", "high school graduation date"],
      graduationyear: ["graduation year", "class year", "high school graduation"],
      highschoolname: ["high school", "high school name", "which high school do you attend", "search high school"],
      schoolstate: ["school state", "state", "resident state"],
      gpa: ["gpa", "grade point average", "unweighted gpa"],
      intendedmajors: ["intended major", "major", "majors", "field of study", "search majors"],
      collegesconsidering: ["college", "colleges considering", "add a college to your list", "search college"],
      activitiessummary: ["activities", "activity summary", "extracurricular"],
      awards: ["awards", "honors"],
      streetaddress: ["street address", "address"],
      city: ["city"],
      postalcode: ["zip", "zip code", "postal code"]
    };
    return (map[compactKey] || [key]).map(normalize);
  }

  function fieldKeys(step) {
    const selectors = [step.selector, ...(Array.isArray(step.aliases) ? step.aliases : [])];
    return Array.from(new Set(selectors.map(fieldKeyFromSelector).filter(Boolean)));
  }

  function fieldKeyFromSelector(selector) {
    const value = String(selector || "");
    const nameMatch = value.match(/\[name=["']?([^"'\]]+)["']?\]/i);
    if (nameMatch) return nameMatch[1];
    const idMatch = value.match(/^#([A-Za-z0-9_-]+)$/);
    return idMatch ? idMatch[1] : "";
  }

  function labelText(field) {
    if (field.id) {
      const label = document.querySelector(`label[for="${cssEscape(field.id)}"]`);
      if (label) return label.textContent || "";
    }
    const wrappingLabel = field.closest("label");
    return wrappingLabel ? wrappingLabel.textContent || "" : "";
  }

  function nearbyText(field) {
    const pieces = [];
    let sibling = field.parentElement?.previousElementSibling;
    for (let index = 0; sibling && index < 3; index += 1) {
      pieces.push(sibling.textContent || "");
      sibling = sibling.previousElementSibling;
    }
    let parent = field.parentElement;
    for (let depth = 0; parent && depth < 3; depth += 1) {
      const text = parent.textContent || "";
      if (text.length < 260) pieces.push(text);
      parent = parent.parentElement;
    }
    return pieces.join(" ");
  }

  function labelForField(field, step) {
    return field.getAttribute("name") || field.id || step.selector || "field";
  }

  function stepLabel(step, field) {
    return String(step.label || metadataForSelector(step.selector).label || (field ? labelForField(field, step) : step.selector) || "field");
  }

  function augmentFillSteps(steps, fieldMap) {
    const output = [];
    const seen = new Set();
    for (const step of steps) {
      if (step.action !== "fill") {
        output.push(step);
        continue;
      }
      const key = fieldKeyFromSelector(step.selector);
      const metadata = metadataForSelector(step.selector);
      const enhanced = {
        ...step,
        label: step.label || metadata.label,
        aliases: safeAliases(Array.from(new Set([...(Array.isArray(step.aliases) ? step.aliases : []), ...metadata.aliases])))
      };
      output.push(enhanced);
      if (key) seen.add(key);
    }

    const compatibleMap = { ...fieldMap };
    if (compatibleMap.student_name) {
      const parts = String(compatibleMap.student_name).trim().split(/\s+/).filter(Boolean);
      if (!compatibleMap.first_name) compatibleMap.first_name = parts[0] || "";
      if (!compatibleMap.last_name && parts.length > 1) compatibleMap.last_name = parts.slice(1).join(" ");
    }

    for (const [key, value] of Object.entries(compatibleMap)) {
      if (!String(value || "").trim() || seen.has(key)) continue;
      const selector = `[name="${key}"]`;
      const metadata = metadataForSelector(selector);
      output.push({
        action: "fill",
        selector,
        value: String(value),
        source: "student_profile",
        label: metadata.label,
        aliases: safeAliases(metadata.aliases)
      });
      seen.add(key);
    }

    return output;
  }

  function safeAliases(aliases) {
    return aliases.filter((alias) => !/undecidedMajor/i.test(String(alias || "")));
  }

  function metadataForSelector(selector) {
    const key = fieldKeyFromSelector(selector);
    const metadata = {
      student_name: { label: "Full name", aliases: ["studentName", "applicantName", "legalName", "fullName", "name"] },
      first_name: { label: "First name", aliases: ["firstName", "applicantFirstName", "studentFirstName", "givenName"] },
      last_name: { label: "Last name", aliases: ["lastName", "applicantLastName", "studentLastName", "familyName", "surname"] },
      preferred_name: { label: "Preferred name", aliases: ["preferredName"] },
      student_email: { label: "Student email", aliases: ["studentEmail", "applicantEmail", "email", "emailAddress"] },
      confirmation_email: { label: "Confirmation email", aliases: ["confirmEmail", "confirmationEmail", "emailConfirmation"] },
      gender: { label: "Gender", aliases: ["gender"] },
      date_of_birth: { label: "Date of birth", aliases: ["dateOfBirth", "dob", "birthDate"] },
      birth_month: { label: "Birth month", aliases: ["birthMonth", "dobMonth", "dateOfBirthMonth"] },
      birth_day: { label: "Birth day", aliases: ["birthDay", "dobDay", "dateOfBirthDay"] },
      birth_year: { label: "Birth year", aliases: ["birthYear", "dobYear", "dateOfBirthYear"] },
      first_generation: { label: "First-generation college student", aliases: ["firstGeneration", "firstGenerationCollegeStudent", "firstGen"] },
      graduation_month: { label: "Graduation month", aliases: ["graduationMonth", "gradMonth", "highSchoolGraduationMonth"] },
      graduation_year: { label: "Graduation year", aliases: ["graduationYear", "gradYear", "classYear", "highSchoolGraduationYear"] },
      high_school_name: { label: "High school", aliases: ["highSchoolName", "highSchool", "schoolName", "hsName"] },
      school_state: { label: "School state", aliases: ["schoolState", "state", "residentState", "homeState"] },
      gpa: { label: "GPA", aliases: ["gradePointAverage", "unweightedGpa", "unweightedGPA"] },
      intended_majors: { label: "Intended major", aliases: ["intendedMajor", "major", "majors", "fieldOfStudy", "plannedMajor"] },
      colleges_considering: { label: "College search", aliases: ["collegeSearch", "collegesConsidering", "collegeList", "college"] },
      activities_summary: { label: "Activities", aliases: ["activitiesSummary", "activities", "extracurriculars", "extracurricularActivities"] },
      awards: { label: "Awards", aliases: ["honors", "awardsHonors", "achievements"] },
      street_address: { label: "Street address", aliases: ["streetAddress", "address", "address1", "addressLine1"] },
      city: { label: "City", aliases: ["city"] },
      postal_code: { label: "ZIP code", aliases: ["zip", "zipCode", "postalCode"] }
    }[key] || { label: "", aliases: [] };
    return {
      label: metadata.label,
      aliases: metadata.aliases.flatMap((name) => [`[name="${name}"]`, `#${name}`])
    };
  }

  function isUnsafeField(field) {
    const tag = field.tagName.toLowerCase();
    const type = String(field.getAttribute("type") || "").toLowerCase();
    if (tag === "button") return true;
    if (field.getAttribute("aria-hidden") === "true") return true;
    return ["submit", "button", "image", "reset", "password", "file", "hidden"].includes(type);
  }

  function isAttestationControl(field) {
    const type = String(field.getAttribute("type") || "").toLowerCase();
    if (type !== "checkbox" && type !== "radio") return false;
    const signal = normalize([
      field.getAttribute("name"),
      field.id,
      field.getAttribute("aria-label"),
      field.getAttribute("placeholder"),
      labelText(field)
    ].join(" "));
    return /\b(attest|attestation|agree|certify|certification|accurate|accuracy|terms)\b/.test(signal);
  }

  function inspectPageState() {
    const text = normalize(document.body ? document.body.innerText : "");
    const visibleButtonLabels = Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button']"))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => normalize(element.innerText || element.value || element.getAttribute("aria-label") || ""));
    const blockers = [
      /payment|credit card|application fee/.test(text) ? "Payment language detected. Review before continuing." : "",
      /signature|e sign|esign/.test(text) ? "Signature language detected. Review before continuing." : "",
      /recommendation|recommender|reference request/.test(text) ? "Recommendation request language detected. Review before continuing." : ""
    ].filter(Boolean);
    return {
      loginRequired: Boolean(document.querySelector("input[type='password']")) || /\b(sign in|log in|login)\b/.test(text),
      reviewReady: visibleButtonLabels.some((label) => /\b(submit|send application|finish|complete application)\b/.test(label)),
      blockers: Array.from(new Set(blockers))
    };
  }

  function safeQuerySelector(selector) {
    try {
      return selector ? document.querySelector(selector) : null;
    } catch {
      return null;
    }
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return CSS.escape(value);
    return String(value || "").replace(/["\\]/g, "\\$&");
  }

  globalThis.scholarshipAgentAutofill = { fillScholarshipAgentPlan, inspectPageState };
})();
