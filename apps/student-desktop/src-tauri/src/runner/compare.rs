pub fn outputs_match(actual: &str, expected: &str) -> bool {
    fn normalize(value: &str) -> String {
        let lf = value.replace("\r\n", "\n").replace('\r', "\n");
        let lines = lf
            .split('\n')
            .map(|line| line.trim_end_matches([' ', '\t']));
        let joined = lines.collect::<Vec<_>>().join("\n");
        joined.trim_end_matches('\n').to_owned()
    }
    normalize(actual) == normalize(expected)
}

#[cfg(test)]
mod tests {
    use super::outputs_match;
    #[test]
    fn matches_language_config_normalization_cases() {
        assert!(outputs_match("15\r\n", "15"));
        assert!(outputs_match("a b  \nc\n\n", "a b\nc"));
        assert!(!outputs_match("a  b", "a b"));
        assert!(!outputs_match("15", "16"));
    }
}
