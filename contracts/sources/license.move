module walrights::license {
    use sui::table::{Self, Table};
    use sui::clock::Clock;
    use walrights::walrights::{License, is_license_valid, license_content_id, license_holder};

    // ═══════════════════════════════════════════
    // OBJECTS
    // ═══════════════════════════════════════════

    /// Global shared registry — tracks how many licenses sold per content
    public struct LicenseRegistry has key {
        id: UID,
        license_count: Table<vector<u8>, u64>,
    }

    /// Admin capability — held by deployer
    public struct AdminCap has key, store {
        id: UID,
    }

    // ═══════════════════════════════════════════
    // INIT — runs once on deploy
    // ═══════════════════════════════════════════

    fun init(ctx: &mut TxContext) {
        let registry = LicenseRegistry {
            id: object::new(ctx),
            license_count: table::new(ctx),
        };
        transfer::share_object(registry);

        let cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(cap, ctx.sender());
    }

    // ═══════════════════════════════════════════
    // FUNCTIONS
    // ═══════════════════════════════════════════

    /// Register a license after purchase — increments sold counter
    public entry fun register_license(
        registry: &mut LicenseRegistry,
        license: &License,
        _ctx: &mut TxContext
    ) {
        let content_id = license_content_id(license);
        if (table::contains(&registry.license_count, content_id)) {
            let count = table::borrow_mut(&mut registry.license_count, content_id);
            *count = *count + 1;
        } else {
            table::add(&mut registry.license_count, content_id, 1);
        };
    }

    /// How many licenses have been sold for a content piece
    public fun license_count(
        registry: &LicenseRegistry,
        content_id: vector<u8>
    ): u64 {
        if (table::contains(&registry.license_count, content_id)) {
            *table::borrow(&registry.license_count, content_id)
        } else {
            0
        }
    }

    /// Verify license is valid for caller right now
    public fun verify(
        license: &License,
        clock: &Clock,
        caller: address
    ): bool {
        license_holder(license) == caller && is_license_valid(license, clock)
    }
}