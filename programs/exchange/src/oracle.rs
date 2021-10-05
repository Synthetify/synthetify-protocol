pub mod oracle {
    use anchor_lang::declare_id;

    #[cfg(feature = "mainnet")]
    declare_id!("AHtgzX45WTKfkPG53L6WYhGEXwQkN1BVknET3sVsLL8J");
    #[cfg(feature = "testnet")]
    declare_id!("AFmdnt9ng1uVxqCmqwQJDAYC5cKTkw8gJKSM5PnzuF6z");
    #[cfg(feature = "devnet")]
    declare_id!("BmA9Z6FjioHJPpjT39QazZyhDRUdZy2ezwx4GiDdE2u2");
    #[cfg(not(any(feature = "mainnet", feature = "testnet", feature = "devnet")))]
    declare_id!("3URDD3Eutw6SufPBzNm2dbwqwvQjRUFCtqkKVsjk3uSE");
}
