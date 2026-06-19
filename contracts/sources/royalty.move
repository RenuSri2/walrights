module walrights::royalty {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::event;

    // ═══════════════════════════════════════════
    // ERROR CODES
    // ═══════════════════════════════════════════

    const EInvalidSplits: u64 = 0;
    const ETotalNotHundred: u64 = 1;
    const ENotRightsOwner: u64 = 2;

    // ═══════════════════════════════════════════
    // OBJECTS
    // ═══════════════════════════════════════════

    /// Defines how revenue is split between collaborators
    /// e.g. Artist 70%, Producer 20%, Manager 10%
    public struct RoyaltySplit has key, store {
        id: UID,
        rights_id: ID,
        creator: address,
        recipients: vector<address>,
        shares_bps: vector<u64>,     // must sum to 10000 (100%)
    }

    // ═══════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════

    public struct SplitCreated has copy, drop {
        split_id: ID,
        rights_id: ID,
        recipients: vector<address>,
        shares_bps: vector<u64>,
    }

    public struct RoyaltyDistributed has copy, drop {
        split_id: ID,
        total_mist: u64,
    }

    // ═══════════════════════════════════════════
    // FUNCTIONS
    // ═══════════════════════════════════════════

    /// Creator defines a revenue split for collaborators
    /// shares_bps must sum to exactly 10000 (= 100%)
    public entry fun create_split(
        rights_id: ID,
        recipients: vector<address>,
        shares_bps: vector<u64>,
        ctx: &mut TxContext
    ) {
        assert!(
            vector::length(&recipients) == vector::length(&shares_bps),
            EInvalidSplits
        );

        // Verify shares sum to 10000 bps
        let mut total: u64 = 0;
        let len = vector::length(&shares_bps);
        let mut i = 0;
        while (i < len) {
            total = total + *vector::borrow(&shares_bps, i);
            i = i + 1;
        };
        assert!(total == 10000, ETotalNotHundred);

        let split = RoyaltySplit {
            id: object::new(ctx),
            rights_id,
            creator: ctx.sender(),
            recipients,
            shares_bps,
        };

        event::emit(SplitCreated {
            split_id: object::id(&split),
            rights_id,
            recipients: split.recipients,
            shares_bps: split.shares_bps,
        });

        transfer::share_object(split);
    }

    /// Distribute a payment according to the defined split
    /// Any rounding dust stays in the coin (goes back to caller)
    public entry fun distribute(
        split: &RoyaltySplit,
        payment: &mut Coin<SUI>,
        ctx: &mut TxContext
    ) {
        let total = coin::value(payment);
        let len = vector::length(&split.recipients);
        let mut i = 0;

        while (i < len) {
            let recipient = *vector::borrow(&split.recipients, i);
            let share_bps = *vector::borrow(&split.shares_bps, i);
            let amount = (total * share_bps) / 10000;

            if (amount > 0) {
                let payout = coin::split(payment, amount, ctx);
                transfer::public_transfer(payout, recipient);
            };
            i = i + 1;
        };

        event::emit(RoyaltyDistributed {
            split_id: object::id(split),
            total_mist: total,
        });
    }

    // ═══════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════

    public fun get_recipients(split: &RoyaltySplit): vector<address> {
        split.recipients
    }

    public fun get_shares(split: &RoyaltySplit): vector<u64> {
        split.shares_bps
    }
}