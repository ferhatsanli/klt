import test from "node:test";
import assert from "node:assert/strict";
import { LESSON_STATUS, fallbackLessonStatus, lessonStatus, matchesStatusFilter } from "../src/status.mjs";

const learnPage={learningMode:"learn",initiallyCompleted:false};
const reviewPage={learningMode:"review",initiallyCompleted:false};
const completedPage={learningMode:"learn",initiallyCompleted:true};

test("catalog classification is used only as fallback",()=>{
  assert.equal(fallbackLessonStatus(learnPage),LESSON_STATUS.TO_LEARN);
  assert.equal(fallbackLessonStatus(reviewPage),LESSON_STATUS.REVIEW);
  assert.equal(fallbackLessonStatus(completedPage),LESSON_STATUS.COMPLETED);
  assert.equal(lessonStatus(reviewPage,{status:LESSON_STATUS.TO_LEARN}),LESSON_STATUS.TO_LEARN);
  assert.equal(lessonStatus(completedPage,{status:LESSON_STATUS.REVIEW}),LESSON_STATUS.REVIEW);
});

test("legacy completed progress remains intact",()=>{
  assert.equal(lessonStatus(reviewPage,{completed:true}),LESSON_STATUS.COMPLETED);
  assert.equal(lessonStatus(reviewPage,{completed:false}),LESSON_STATUS.TO_LEARN);
});

test("manual status transitions resolve in order",()=>{
  let progress={status:LESSON_STATUS.TO_LEARN,completed:false};
  assert.equal(lessonStatus(reviewPage,progress),LESSON_STATUS.TO_LEARN);
  progress={status:LESSON_STATUS.REVIEW,completed:false};
  assert.equal(lessonStatus(reviewPage,progress),LESSON_STATUS.REVIEW);
  progress={status:LESSON_STATUS.COMPLETED,completed:true};
  assert.equal(lessonStatus(reviewPage,progress),LESSON_STATUS.COMPLETED);
  progress={status:LESSON_STATUS.TO_LEARN,completed:false};
  assert.equal(lessonStatus(reviewPage,progress),LESSON_STATUS.TO_LEARN);
});

test("filters match exactly one explicit status",()=>{
  for(const [filter,status] of [["todo",LESSON_STATUS.TO_LEARN],["review",LESSON_STATUS.REVIEW],["done",LESSON_STATUS.COMPLETED]]){
    assert.equal(matchesStatusFilter(status,filter),true);
    for(const other of Object.values(LESSON_STATUS).filter(value=>value!==status))assert.equal(matchesStatusFilter(other,filter),false);
    assert.equal(matchesStatusFilter(status,"all"),true);
  }
});
