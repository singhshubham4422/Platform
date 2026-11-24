use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunSpec {
    pub language: String,
    pub source: String,
    pub tests: Vec<TestCase>,
    pub limits: Limits,
    pub mode: Mode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TestCase {
    pub id: String,
    pub input: String,
    pub expected_output: Option<String>,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub time_limit_ms: u64,
    pub memory_limit_mb: u64,
    pub output_limit_kb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum Mode {
    Run,
    Submit,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub test_id: String,
    pub hidden: bool,
    pub verdict: String,
    pub time_ms: u64,
    pub memory_kb: u64,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub expected_output: Option<String>,
    pub input: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub attempt_id: String,
    pub mode: Mode,
    pub verdict: String,
    pub compile_output: Option<String>,
    pub tests: Vec<TestResult>,
    pub passed: usize,
    pub total: usize,
    pub total_time_ms: u64,
    pub started_at: String,
    pub finished_at: String,
}
