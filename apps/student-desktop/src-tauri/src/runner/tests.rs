use super::*;

#[test]
fn mode_and_contract_fields_serialize_in_camel_case() {
    let result = RunResult {
        attempt_id: "id".into(),
        mode: Mode::Custom,
        verdict: "ACCEPTED".into(),
        compile_output: None,
        tests: vec![],
        passed: 0,
        total: 1,
        total_time_ms: 0,
        started_at: "2026-01-01T00:00:00.000Z".into(),
        finished_at: "2026-01-01T00:00:00.000Z".into(),
    };
    let v = serde_json::to_value(result).unwrap();
    assert_eq!(v["mode"], "CUSTOM");
    assert!(v.get("attemptId").is_some());
}
#[test]
fn java_class_matches_language_config_rules() {
    assert_eq!(
        java_main_class("public final class Solution {}"),
        "Solution"
    );
    assert_eq!(java_main_class("class Hidden {}"), "Main");
}
