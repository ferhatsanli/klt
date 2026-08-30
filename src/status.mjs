export const LESSON_STATUS = Object.freeze({
  TO_LEARN: "toLearn",
  REVIEW: "review",
  COMPLETED: "completed"
});

const VALID_STATUSES = new Set(Object.values(LESSON_STATUS));

export function fallbackLessonStatus(page) {
  if (page.initiallyCompleted === true) return LESSON_STATUS.COMPLETED;
  if (page.learningMode === "review") return LESSON_STATUS.REVIEW;
  return LESSON_STATUS.TO_LEARN;
}

export function lessonStatus(page, progress) {
  if (progress && VALID_STATUSES.has(progress.status)) return progress.status;
  if (progress && typeof progress.completed === "boolean") {
    return progress.completed ? LESSON_STATUS.COMPLETED : LESSON_STATUS.TO_LEARN;
  }
  return fallbackLessonStatus(page);
}

export function isLessonStatus(value) {
  return VALID_STATUSES.has(value);
}

export function matchesStatusFilter(status, filter) {
  if (filter === "all") return true;
  if (filter === "todo") return status === LESSON_STATUS.TO_LEARN;
  if (filter === "review") return status === LESSON_STATUS.REVIEW;
  if (filter === "done") return status === LESSON_STATUS.COMPLETED;
  return false;
}
