# Take Home Technical Assessment - AI Research Assistant using MCP

## Overview

You are building a lightweight AI Research Assistant for a regional NHS Research and Analytics Platform.

Researchers use the assistant to discover approved research projects, explore available datasets, and perform approved analytical queries against synthetic research data. The platform follows a service-oriented architecture where backend capabilities are exposed through the Model Context Protocol (MCP).

Your solution should demonstrate how an AI agent can safely interact with MCP tools to answer researchers' questions while applying appropriate governance controls.

## Objective

The goal of this exercise is to assess practical AI engineering, software engineering, system design, API development, and reasoning.

We are more interested in your engineering decisions, architecture, code quality, documentation, and problem-solving than in implementing a production-ready system.

A clean, well-structured solution is preferred over excessive features.

## Requirements

### 1. Build an MCP Server

Design and implement your own MCP server.

The MCP server should expose tools that enable an AI agent to interact with the research platform.

At a minimum, the MCP server should support:
- Discover available research projects
- Retrieve project information
- Search available datasets
- Retrieve dataset metadata
- Execute analytical queries against the supplied synthetic data

You are free to introduce additional tools if you feel they improve the design.

### 2. Build an AI Research Assistant

Implement an AI agent capable of answering natural language questions from researchers.

The assistant should interact with your MCP server rather than directly accessing the underlying data.

The assistant should determine:
- Which MCP tools to invoke
- The order in which tools should be called
- How the results should be combined into a final response

You may use any LLM provider, agent framework, or orchestration approach.

### 3. Expose an API

Expose a REST API to interact with the assistant.

Example endpoint: `POST /query`

Example request:
```json
{"question": "Which datasets are available for diabetes research?"}
```

Example response:
```json
{"answer": "...", "sources": ["DS001"], "trace_id": "a1b2c3d4"}
```

The API should delegate reasoning to the AI assistant.

### 4. Apply Governance Rules

Implement at least one governance rule.

Example: Suppress analytical results containing fewer than five records.

Your design should allow additional governance policies to be added with minimal architectural changes.

### 5. Observability

Generate basic audit information for each request including:
- Request identifier
- MCP tools invoked
- Execution time
- Errors where applicable

### 6. Containerise the Application

Provide a Dockerfile and simple run instructions.

Docker Compose and Kubernetes manifests are optional.

### 7. Documentation

Provide a README containing:
- Architecture overview
- Technology choices
- Assumptions
- Setup instructions
- Known limitations
- Future improvements

## Mock Data

Synthetic data is provided in [`mock-data/`](mock-data/):
- `projects.json`
- `datasets.json`
- `researchers.json`
- `sample_query_results.json`
- `evaluation_questions.json`

You may store and access the data using any approach you consider appropriate.

## Example Scenarios

The examples below are sample responses, not the exact expected output. They show the response structure (`answer`, `sources`, `trace_id`) and correct facts from the mock data. Your assistant's actual answer can look however you like; short, long, with tables, whatever fits your design.

**Dataset Discovery**

Request:
```json
{"question": "List all active research projects."}
```
Example Response:
```json
{"answer": "The platform currently contains 15 active research projects.", "sources": ["PRJ001", "PRJ002", "PRJ003", "PRJ005", "PRJ006", "PRJ007", "PRJ009", "PRJ010", "PRJ011", "PRJ013", "PRJ014", "PRJ015", "PRJ017", "PRJ018", "PRJ019"], "trace_id": "a1b2c3d4"}
```

**Dataset Search**

Request:
```json
{"question": "Show datasets related to diabetes."}
```
Example Response:
```json
{"answer": "One dataset is available for diabetes research: Primary Care Diabetes Cohort.", "sources": ["DS001"], "trace_id": "a1b2c3d4"}
```

**Governance**

Request:
```json
{"question": "Run an analysis on the Stroke Recovery Registry dataset."}
```
Example Response:
```json
{"answer": "Results have been suppressed because the analytical result contains fewer than five records.", "sources": ["DS005"], "trace_id": "a1b2c3d4"}
```

**Invalid Request**

Request:
```json
{"question": "Show datasets from Project ABC123"}
```
Example Response:
```json
{"answer": "Project not found.", "sources": [], "trace_id": "a1b2c3d4"}
```

## Freedom of Implementation

You are free to choose:
- Programming language
- AI framework
- LLM provider
- Database
- MCP implementation
- Project structure

Single-agent and multi-agent architectures are both acceptable. If you choose a particular architecture, please explain your reasoning.

## Submission Instructions

1. Fork this repository into your own GitHub account.
2. Implement your solution within your fork.
3. Once completed, share the URL of your repository as your submission, containing:
   - Source code
   - README
   - Dockerfile
   - Requirements or dependency file
   - Configuration files required to run the application

## Notes

You are free to make reasonable assumptions where requirements are ambiguous. Please document any assumptions clearly in the README. There is intentionally no single correct solution. We are interested in understanding your engineering approach, design decisions, and ability to justify architectural trade-offs.
