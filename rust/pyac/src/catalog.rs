use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub struct PyacCatalog {
    pub format: String,
    pub pack_format: String,
    pub pack_hash: String,
    pub record_count: u64,
    pub executable_count: u64,
    pub unsupported_count: u64,
    pub pack_locator: Option<String>,
    pub records: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatalogError {
    InvalidSource,
    MissingHeader,
    InvalidSentence(String),
    InvalidMetadata(String),
    InvalidRow(String),
    InvalidJson(String),
    MissingMetadata(String),
}

impl CatalogError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidSource | Self::MissingHeader => "invalid-catalog-text",
            Self::InvalidSentence(_) => "invalid-catalog-sentence",
            Self::InvalidMetadata(_) => "invalid-catalog-metadata",
            Self::InvalidRow(_) => "invalid-catalog-row",
            Self::InvalidJson(_) => "invalid-catalog-json",
            Self::MissingMetadata(_) => "missing-catalog-metadata",
        }
    }
}

impl Display for CatalogError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidSource => formatter.write_str("catalog source must be UTF-8 text"),
            Self::MissingHeader => formatter.write_str("catalog has no series header"),
            Self::InvalidSentence(message)
            | Self::InvalidMetadata(message)
            | Self::InvalidRow(message)
            | Self::InvalidJson(message) => formatter.write_str(message),
            Self::MissingMetadata(name) => write!(formatter, "catalog is missing metadata {name}"),
        }
    }
}

impl std::error::Error for CatalogError {}

fn parse_text(token: &str) -> Result<String, CatalogError> {
    serde_json::from_str(token).map_err(|error| CatalogError::InvalidJson(error.to_string()))
}

fn parse_sentence(line: &str) -> Result<(&str, &str), CatalogError> {
    let rest = line.strip_prefix("su name ").ok_or_else(|| {
        CatalogError::InvalidSentence(format!("unsupported catalog sentence: {line}"))
    })?;
    let (name, body) = rest.split_once(" ob ").ok_or_else(|| {
        CatalogError::InvalidSentence(format!("catalog sentence has no ob clause: {line}"))
    })?;
    if name.is_empty() {
        return Err(CatalogError::InvalidSentence(
            "catalog sentence has no name".to_owned(),
        ));
    }
    Ok((name, body))
}

fn parse_metadata_value(body: &str, name: &str) -> Result<Value, CatalogError> {
    let value = body
        .strip_suffix(" be catalog metadata ya")
        .ok_or_else(|| {
            CatalogError::InvalidMetadata(format!("metadata row {name} has an invalid ending"))
        })?;
    if let Some(token) = value.strip_prefix("text ") {
        return parse_text(token).map(Value::String);
    }
    if let Some(token) = value.strip_prefix("num ") {
        return token.parse::<u64>().map(Value::from).map_err(|error| {
            CatalogError::InvalidMetadata(format!(
                "metadata row {name} has an invalid number: {error}"
            ))
        });
    }
    Err(CatalogError::InvalidMetadata(format!(
        "metadata row {name} has an unsupported value"
    )))
}

fn required_text(metadata: &BTreeMap<String, Value>, name: &str) -> Result<String, CatalogError> {
    metadata
        .get(name)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| CatalogError::MissingMetadata(name.to_owned()))
}

fn required_number(metadata: &BTreeMap<String, Value>, name: &str) -> Result<u64, CatalogError> {
    metadata
        .get(name)
        .and_then(Value::as_u64)
        .ok_or_else(|| CatalogError::MissingMetadata(name.to_owned()))
}

pub fn parse_catalog_pya(source: &str) -> Result<PyacCatalog, CatalogError> {
    if source.is_empty() {
        return Err(CatalogError::InvalidSource);
    }

    let mut has_header = false;
    let mut has_footer = false;
    let mut metadata = BTreeMap::new();
    let mut records = Vec::new();

    for raw_line in source.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if line == "prah" {
            has_footer = true;
            continue;
        }
        if line.ends_with(" be series def") {
            has_header = true;
            continue;
        }
        let (name, body) = parse_sentence(line)?;
        if body.ends_with(" be catalog metadata ya") {
            metadata.insert(name.to_owned(), parse_metadata_value(body, name)?);
            continue;
        }
        if let Some(token) = body.strip_suffix(" be codelet ya") {
            let text_token = token
                .strip_prefix("text ")
                .ok_or_else(|| CatalogError::InvalidRow(name.to_owned()))?;
            let record_text = parse_text(text_token)
                .map_err(|error| CatalogError::InvalidRow(error.to_string()))?;
            let record = serde_json::from_str(&record_text)
                .map_err(|error| CatalogError::InvalidRow(error.to_string()))?;
            records.push(record);
            continue;
        }
        return Err(CatalogError::InvalidSentence(format!(
            "unsupported catalog row {name}"
        )));
    }

    if !has_header || !has_footer {
        return Err(CatalogError::MissingHeader);
    }

    Ok(PyacCatalog {
        format: required_text(&metadata, "format")?,
        pack_format: required_text(&metadata, "pack format")?,
        pack_hash: required_text(&metadata, "pack hash")?,
        record_count: required_number(&metadata, "record count")?,
        executable_count: required_number(&metadata, "executable count")?,
        unsupported_count: required_number(&metadata, "unsupported count")?,
        pack_locator: metadata
            .get("pack locator")
            .and_then(Value::as_str)
            .map(str::to_owned),
        records,
    })
}
