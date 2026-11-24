use super::read::safe_path;

#[test]
fn pack_paths_reject_traversal_and_absolute_paths() {
    for p in [
        "../escape",
        "a/../../escape",
        "C:/temp/a",
        "/root/a",
        "a\\b",
        "",
    ] {
        assert!(!safe_path(p), "{p}")
    }
    for p in ["manifest.json", "questions/q.json", "tests/q.hidden.json"] {
        assert!(safe_path(p), "{p}")
    }
}

#[test]
fn pack_row_migration_is_repeatable() {
    let mut c = rusqlite::Connection::open_in_memory().unwrap();
    crate::store::migrate(&mut c).unwrap();
    crate::store::migrate(&mut c).unwrap();
    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='packs'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1)
}
