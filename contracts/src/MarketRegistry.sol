// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IMarket} from "./interfaces/IMarket.sol";
import {IMarketRegistry} from "./interfaces/IMarketRegistry.sol";

/// @title MarketRegistry
/// @notice Factory + indexer for DarkOdds markets. Creates EIP-1167 minimal
///         proxy clones of an unitialised Market template and initialises them
///         in the same tx.
///
///         The registry deliberately holds no encrypted state. cUSDC and the
///         Nox protocol contract handle ACL — the registry just owns the
///         template pointer and the id → market mapping.
contract MarketRegistry is IMarketRegistry, Ownable {
    error InvalidImplementation();
    error InvalidConfidentialUSDC();
    error InvalidResolutionOracle();
    error InvalidExpiry();

    address public marketImplementation;
    address public immutable confidentialUSDC;
    address public resolutionOracle;
    uint256 public nextMarketId;
    mapping(uint256 id => address) public markets;

    event ResolutionOracleSet(address indexed previous, address indexed next);

    constructor(
        address marketImplementation_,
        address confidentialUSDC_,
        address resolutionOracle_,
        address initialOwner
    ) Ownable(initialOwner) {
        if (marketImplementation_ == address(0)) revert InvalidImplementation();
        if (confidentialUSDC_ == address(0)) revert InvalidConfidentialUSDC();
        if (resolutionOracle_ == address(0)) revert InvalidResolutionOracle();
        marketImplementation = marketImplementation_;
        confidentialUSDC = confidentialUSDC_;
        resolutionOracle = resolutionOracle_;
    }

    function createMarket(
        string calldata question_,
        string calldata resolutionCriteria,
        uint8 oracleType,
        uint256 expiryTs,
        uint256 protocolFeeBps
    ) external onlyOwner returns (uint256 id, address market) {
        if (expiryTs <= block.timestamp) revert InvalidExpiry();

        id = nextMarketId;
        unchecked {
            nextMarketId = id + 1;
        }

        market = Clones.clone(marketImplementation);
        markets[id] = market;

        // The cloned proxy delegates all calls to `marketImplementation`. We
        // initialise its storage by calling through the proxy.
        IMarket(market).initialize(
            id,
            question_,
            resolutionCriteria,
            oracleType,
            expiryTs,
            protocolFeeBps,
            confidentialUSDC,
            resolutionOracle,
            owner() // current registry owner becomes that market's admin
        );

        emit MarketCreated(id, market, question_, expiryTs);
    }

    function setMarketImplementation(address newImpl) external onlyOwner {
        if (newImpl == address(0)) revert InvalidImplementation();
        address previous = marketImplementation;
        marketImplementation = newImpl;
        emit MarketImplementationUpdated(previous, newImpl);
    }

    function setResolutionOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert InvalidResolutionOracle();
        address previous = resolutionOracle;
        resolutionOracle = newOracle;
        emit ResolutionOracleSet(previous, newOracle);
    }
}
