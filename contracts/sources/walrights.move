module walrights::walrights {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use sui::event;

    // ═══════════════════════════════════════════
    // ERROR CODES
    // ═══════════════════════════════════════════
    const ENotOwner: u64 = 0;
    const EInsufficientPayment: u64 = 1;
    const ELicenseExpired: u64 = 2;
    const ENotLicenseHolder: u64 = 3;
    const EWrongContent: u64 = 4;
    const EListingNotActive: u64 = 5;

    // ═══════════════════════════════════════════
    // LICENSE TYPE CONSTANTS
    // ═══════════════════════════════════════════
    const LICENSE_STREAMING: u8 = 0;
    const LICENSE_SYNC: u8 = 1;
    const LICENSE_PRINT: u8 = 2;
    const LICENSE_BROADCAST: u8 = 3;
    const LICENSE_REMIX: u8 = 4;

    // ═══════════════════════════════════════════
    // CORE OBJECTS
    // ═══════════════════════════════════════════

    /// The master rights object — minted by creator, source of truth
    public struct MasterRights has key, store {
        id: UID,
        owner: address,
        title: vector<u8>,
        content_hash: vector<u8>,       // SHA-256 of original file
        walrus_blob_id: vector<u8>,     // Walrus storage reference
        royalty_bps: u64,               // basis points e.g. 1000 = 10%
        created_at: u64,
    }

    /// A listing — creator posts this to sell a license type
    public struct LicenseListing has key, store {
        id: UID,
        rights_id: ID,                  // points to MasterRights
        content_id: vector<u8>,         // same as content_hash
        license_type: u8,
        price_mist: u64,                // price in MIST (1 SUI = 1_000_000_000)
        duration_epochs: u64,           // 0 = perpetual
        creator: address,
        active: bool,
    }

    /// A purchased license — lives in buyer's wallet
    public struct License has key, store {
        id: UID,
        rights_id: ID,
        content_id: vector<u8>,
        license_type: u8,
        holder: address,
        valid_until: u64,               // epoch timestamp, 0 = perpetual
        purchased_at: u64,
    }

    // ═══════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════

    public struct RightsMinted has copy, drop {
        rights_id: ID,
        owner: address,
        title: vector<u8>,
        walrus_blob_id: vector<u8>,
    }

    public struct LicensePurchased has copy, drop {
        license_id: ID,
        rights_id: ID,
        buyer: address,
        license_type: u8,
        price_mist: u64,
        valid_until: u64,
    }

    // ═══════════════════════════════════════════
    // CREATOR FUNCTIONS
    // ═══════════════════════════════════════════

    /// Creator mints master rights for their content
    public entry fun mint_rights(
        title: vector<u8>,
        content_hash: vector<u8>,
        walrus_blob_id: vector<u8>,
        royalty_bps: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let rights = MasterRights {
            id: object::new(ctx),
            owner: ctx.sender(),
            title,
            content_hash,
            walrus_blob_id,
            royalty_bps,
            created_at: clock::timestamp_ms(clock),
        };

        event::emit(RightsMinted {
            rights_id: object::id(&rights),
            owner: ctx.sender(),
            title: rights.title,
            walrus_blob_id: rights.walrus_blob_id,
        });

        transfer::transfer(rights, ctx.sender());
    }

    /// Creator lists a license type for sale
    public entry fun create_listing(
        rights: &MasterRights,
        license_type: u8,
        price_mist: u64,
        duration_epochs: u64,
        ctx: &mut TxContext
    ) {
        assert!(rights.owner == ctx.sender(), ENotOwner);

        let listing = LicenseListing {
            id: object::new(ctx),
            rights_id: object::id(rights),
            content_id: rights.content_hash,
            license_type,
            price_mist,
            duration_epochs,
            creator: ctx.sender(),
            active: true,
        };

        transfer::share_object(listing);
    }

    /// Creator can toggle listing on/off
    public entry fun toggle_listing(
        listing: &mut LicenseListing,
        ctx: &mut TxContext
    ) {
        assert!(listing.creator == ctx.sender(), ENotOwner);
        listing.active = !listing.active;
    }

    // ═══════════════════════════════════════════
    // BUYER FUNCTIONS
    // ═══════════════════════════════════════════

    /// Buyer purchases a license — SUI flows to creator instantly
    public entry fun buy_license(
        listing: &LicenseListing,
        payment: &mut Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(listing.active, EListingNotActive);
        assert!(
            coin::value(payment) >= listing.price_mist,
            EInsufficientPayment
        );

        // Split exact payment and send to creator instantly
        let paid = coin::split(payment, listing.price_mist, ctx);
        transfer::public_transfer(paid, listing.creator);

        // Calculate expiry
        let now = clock::timestamp_ms(clock);
        let valid_until = if (listing.duration_epochs == 0) {
            0 // perpetual
        } else {
            now + (listing.duration_epochs * 86400000) // days in ms
        };

        // Mint license to buyer's wallet
        let license = License {
            id: object::new(ctx),
            rights_id: listing.rights_id,
            content_id: listing.content_id,
            license_type: listing.license_type,
            holder: ctx.sender(),
            valid_until,
            purchased_at: now,
        };

        event::emit(LicensePurchased {
            license_id: object::id(&license),
            rights_id: listing.rights_id,
            buyer: ctx.sender(),
            license_type: listing.license_type,
            price_mist: listing.price_mist,
            valid_until,
        });

        transfer::transfer(license, ctx.sender());
    }

    // ═══════════════════════════════════════════
    // SEAL INTEGRATION — THE GATEKEEPER
    // ═══════════════════════════════════════════

    /// Called by Seal nodes before releasing decryption key shares
    /// If this aborts → no decryption. No admin. No override. Just math.
    public fun seal_approve(
        id: vector<u8>,
        license: &License,
        clock: &Clock,
        ctx: &TxContext
    ) {
        // Check 1: caller is the license holder
        assert!(license.holder == ctx.sender(), ENotLicenseHolder);

        // Check 2: license covers this content
        assert!(license.content_id == id, EWrongContent);

        // Check 3: not expired (0 = perpetual, skip check)
        if (license.valid_until != 0) {
            assert!(
                clock::timestamp_ms(clock) <= license.valid_until,
                ELicenseExpired
            );
        };
    }

    // ═══════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════

    public fun get_license_type_name(license_type: u8): vector<u8> {
        if (license_type == LICENSE_STREAMING) { b"Streaming" }
        else if (license_type == LICENSE_SYNC) { b"Sync" }
        else if (license_type == LICENSE_PRINT) { b"Print" }
        else if (license_type == LICENSE_BROADCAST) { b"Broadcast" }
        else { b"Remix" }
    }

    public fun is_license_valid(license: &License, clock: &Clock): bool {
        if (license.valid_until == 0) { true }
        else { clock::timestamp_ms(clock) <= license.valid_until }
    }

    public fun license_holder(license: &License): address { license.holder }
    public fun license_content_id(license: &License): vector<u8> { license.content_id }
    public fun license_valid_until(license: &License): u64 { license.valid_until }
    public fun rights_owner(rights: &MasterRights): address { rights.owner }
    public fun rights_blob_id(rights: &MasterRights): vector<u8> { rights.walrus_blob_id }
}