// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract ConfidentialMarketSpec is ReentrancyGuard {
    // --- Types & Constants ---

    enum MarketState {
        Open,
        Closed,
        Resolving,
        ClaimWindow,
        Invalid
    }

    // Outcomes: 0 = NO, 1 = YES
    uint8 public constant OUTCOME_NO = 0;
    uint8 public constant OUTCOME_YES = 1;
    uint8 public constant OUTCOME_INVALID = 2;

    uint256 public constant FEE_MAX_BPS = 1000; // 10% max (basis points)
    uint256 public constant FEE_DENOMINATOR = 10000;

    // --- Storage ---

    address public immutable owner;
    MarketState public state;
    uint8 public resolvedOutcome; // 0 = NO, 1 = YES, 2 = INVALID, only valid after resolution

    uint256 public feeBps; // protocol fee in basis points (max 1000)
    uint256 public totalAmount; // total amount bet
    uint256[2] public totalOnSide; // [NO, YES] total staked per side

    mapping(address => uint256[2]) public userBets; // user => [NO, YES] amount
    mapping(address => bool) public hasClaimed; // user => claimed winnings/refund

    // --- Events ---

    event BetPlaced(address indexed user, uint8 indexed side, uint256 amount);
    event MarketResolved(uint8 indexed outcome);
    event ClaimSettled(address indexed user, uint256 payout);
    event Refunded(address indexed user, uint256 refund);

    // --- Errors ---

    error NotOwner();
    error InvalidState();
    error InvalidSide();
    error AmountZero();
    error FeeTooHigh();
    error AlreadyClaimed();
    error NotResolvable();
    error NothingToClaim();
    error NothingToRefund();

    // --- Modifiers ---

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier inState(MarketState expected) {
        if (state != expected) revert InvalidState();
        _;
    }

    // --- Constructor ---

    constructor(uint256 _feeBps) {
        if (_feeBps > FEE_MAX_BPS) revert FeeTooHigh();
        owner = msg.sender;
        feeBps = _feeBps;
        state = MarketState.Open;
    }

    // --- External Functions ---

    function placeBet(uint8 side, uint256 amount)
        external
        payable
        nonReentrant
        inState(MarketState.Open)
    {
        if (side != OUTCOME_NO && side != OUTCOME_YES) revert InvalidSide();
        if (amount == 0 || msg.value != amount) revert AmountZero();

        userBets[msg.sender][side] += amount;
        totalOnSide[side] += amount;
        totalAmount += amount;

        emit BetPlaced(msg.sender, side, amount);
    }

    function closeMarket()
        external
        onlyOwner
        inState(MarketState.Open)
    {
        state = MarketState.Closed;
    }

    function resolveOracle(uint8 outcome)
        external
        onlyOwner
        inState(MarketState.Closed)
    {
        // Valid outcomes: 0 (NO), 1 (YES), 2 (INVALID)
        if (outcome != OUTCOME_NO && outcome != OUTCOME_YES && outcome != OUTCOME_INVALID) revert InvalidSide();

        resolvedOutcome = outcome;

        if (outcome == OUTCOME_INVALID) {
            state = MarketState.Invalid;
        } else {
            state = MarketState.ClaimWindow;
        }
        emit MarketResolved(outcome);
    }

    function claimWinnings()
        external
        nonReentrant
        inState(MarketState.ClaimWindow)
    {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();
        uint8 winningSide = resolvedOutcome;
        uint8 losingSide = (winningSide == OUTCOME_NO) ? OUTCOME_YES : OUTCOME_NO;

        uint256 userStake = userBets[msg.sender][winningSide];
        if (userStake == 0) revert NothingToClaim();

        uint256 totalWinner = totalOnSide[winningSide];
        uint256 totalLoser = totalOnSide[losingSide];

        // Proportional payout: user's stake + share of losing pool minus protocol fee
        uint256 winnings = userStake;
        if (totalWinner > 0 && totalLoser > 0) {
            winnings += (totalLoser * userStake) / totalWinner;
        }
        uint256 fee = (winnings - userStake) * feeBps / FEE_DENOMINATOR;
        uint256 payout = winnings - fee;

        hasClaimed[msg.sender] = true;

        // Transfer payout
        (bool sent, ) = payable(msg.sender).call{value: payout}("");
        require(sent, "Transfer failed");

        emit ClaimSettled(msg.sender, payout);
    }

    function refundIfInvalid()
        external
        nonReentrant
        inState(MarketState.Invalid)
    {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();

        uint256 refund = userBets[msg.sender][OUTCOME_NO] + userBets[msg.sender][OUTCOME_YES];
        if (refund == 0) revert NothingToRefund();

        hasClaimed[msg.sender] = true;

        (bool sent, ) = payable(msg.sender).call{value: refund}("");
        require(sent, "Refund failed");

        emit Refunded(msg.sender, refund);
    }

    // --- Admin Functions ---

    function setFee(uint256 _feeBps) external onlyOwner inState(MarketState.Open) {
        if (_feeBps > FEE_MAX_BPS) revert FeeTooHigh();
        feeBps = _feeBps;
    }

    function withdrawFees(address to) external onlyOwner {
        // Fees are protocol revenue, only withdrawable after market is settled and all claims/refunds are made
        require(state == MarketState.ClaimWindow || state == MarketState.Invalid, "Not settled");
        uint256 balance = address(this).balance;
        uint256 claimable;
        if (state == MarketState.ClaimWindow) {
            uint8 winningSide = resolvedOutcome;
            uint8 losingSide = (winningSide == OUTCOME_NO) ? OUTCOME_YES : OUTCOME_NO;
            uint256 totalWinner = totalOnSide[winningSide];
            uint256 totalLoser = totalOnSide[losingSide];
            if (totalWinner > 0 && totalLoser > 0) {
                claimable = (totalLoser * feeBps) / FEE_DENOMINATOR;
            }
        }
        if (claimable > 0 && claimable <= balance) {
            (bool sent, ) = payable(to).call{value: claimable}("");
            require(sent, "Fee withdrawal failed");
        }
    }

    // --- View Functions ---

    function getUserBets(address user) external view returns (uint256 no, uint256 yes) {
        no = userBets[user][OUTCOME_NO];
        yes = userBets[user][OUTCOME_YES];
    }

    function getTotalOnSide() external view returns (uint256 no, uint256 yes) {
        no = totalOnSide[OUTCOME_NO];
        yes = totalOnSide[OUTCOME_YES];
    }
}