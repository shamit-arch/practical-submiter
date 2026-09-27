const test = require("node:test");
const assert = require("node:assert");
const { parsePracticalsFromText } = require("../parsePdf");

test("table-style lists with bare numbers (no '.' or ')') are parsed", () => {
  const text = [
    "Semester III",
    "Competitive Programming - Laboratory",
    "Course Code: 252601302",
    "Practical",
    "No. Practical Title",
    "31 Write a C++ program to determine the minimum number of coins required",
    "for a given amount using Greedy Strategy.",
    "32 Write a C++ program to find the maximum profit from job sequencing",
    "using Greedy Algorithm.",
    "33 Explain Ethics in Competitive Programming.",
    "-- 1 of 1 --",
  ].join("\n");
  const aims = parsePracticalsFromText(text);
  assert.deepStrictEqual(Object.keys(aims), ["31", "32", "33"]);
  assert.strictEqual(aims[31], "Write a C++ program to determine the minimum number of coins required for a given amount using Greedy Strategy.");
  assert.strictEqual(aims[32], "Write a C++ program to find the maximum profit from job sequencing using Greedy Algorithm.");
});

test("a wrapped line starting with a number is not mistaken for a new practical", () => {
  const aims = parsePracticalsFromText("1 Find the largest of\n10 numbers entered by the user.\n2 Sort an array.");
  assert.deepStrictEqual(aims, { 1: "Find the largest of 10 numbers entered by the user.", 2: "Sort an array." });
});

test("numbered formats with separators still work", () => {
  const aims = parsePracticalsFromText("1. Add two numbers.\n2) Reverse a string.\nPractical 3: Sort an array.");
  assert.deepStrictEqual(aims, { 1: "Add two numbers.", 2: "Reverse a string.", 3: "Sort an array." });
});

test("pdf.js text items from a table are joined into lines (number in its own cell)", () => {
  const { textFromPdfItems } = require("../public/lib/aims");
  // Shape of what pdf.js returns for a two-column table row: the number cell sits
  // vertically between the two lines of the aim, and a page number at the bottom.
  const item = (str, y, hasEOL = false) => ({ str, hasEOL, transform: [1, 0, 0, 1, 50, y] });
  const pages = [[
    item("Practical", 700), item("No.", 690, true), item("Practical Title", 695, true),
    item("31 ", 660), item("Write a C++ program to determine the minimum number of coins required", 666, true),
    item("for a given amount using Greedy Strategy.", 654, true),
    item("32 ", 630), item("Write a C++ program to find the maximum profit from job sequencing", 636, true),
    item("using Greedy Algorithm.", 624, true),
    item("1", 40, true),
  ]];
  const aims = parsePracticalsFromText(textFromPdfItems(pages));
  assert.deepStrictEqual(aims, {
    31: "Write a C++ program to determine the minimum number of coins required for a given amount using Greedy Strategy.",
    32: "Write a C++ program to find the maximum profit from job sequencing using Greedy Algorithm.",
  });
});
