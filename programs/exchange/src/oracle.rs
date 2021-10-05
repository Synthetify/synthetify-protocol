pub mod oracle {
    use anchor_lang::declare_id;

    #[cfg(feature = "mainnet")]
    declare_id!("FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH");
    #[cfg(feature = "testnet")]
    declare_id!("8tfDNiaEyrV6Q1U4DEXrEigs9DoDtkugzFbybENEbCDz");
    #[cfg(feature = "devnet")]
    declare_id!("gSbePebfvPy7tRqimPoVecS2UsBvYv46ynrzWocc92s");
    #[cfg(not(any(feature = "mainnet", feature = "testnet", feature = "devnet")))]
    declare_id!("3URDD3Eutw6SufPBzNm2dbwqwvQjRUFCtqkKVsjk3uSE");
}
