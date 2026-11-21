mod index;
mod model;
mod operation;
mod reader;
mod reader_codec;
mod reader_index;
mod volume;
mod volume_records;
mod wire;

pub use index::DictionaryIndex;
pub use model::{DictionaryEntry, DictionaryIndexError, LexicalForm, SourceGloss, SourceLink};
pub use operation::{
    OperationArgument, OperationArgumentType, OperationResult, OperationSignature,
    OperationSignatureKey,
};
pub use reader::{
    DictionaryFileReader, DictionaryReadError, DictionarySection, DictionarySourceMatch,
};
pub use volume::{
    DictionaryMetadata, DictionaryVolume, DictionaryVolumeEntry, DictionaryVolumeError,
    encode_dictionary,
};
pub use wire::{
    DictionaryWireError, Field as DictionaryField, Value as DictionaryValue, encode_text_sentence,
};
