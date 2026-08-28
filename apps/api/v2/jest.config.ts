import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  moduleFileExtensions: ["ts", "js", "json"],
  rootDir: ".",
  moduleNameMapper: {
    "@/(.*)": "<rootDir>/src/$1",
    "test/(.*)": "<rootDir>/test/$1",
  },
  testEnvironment: "node",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  setupFiles: ["<rootDir>/test/setEnvVars.ts"],
  testPathIgnorePatterns: ["/dist/", "/node_modules/"],
  transformIgnorePatterns: ["/dist/", "/node_modules/"],
  // Several specs compile the whole AppModule, which is large enough that a full fan-out
  // of workers each holding one gets them OOM-killed (SIGKILL, reported as "test suite
  // failed to run" rather than as a failing test, which is a misleading way to find out).
  // jest-e2e.ts already caps workers and recycles them for the same reason.
  maxWorkers: "50%",
  workerIdleMemoryLimit: "1GB",
};

export default config;
