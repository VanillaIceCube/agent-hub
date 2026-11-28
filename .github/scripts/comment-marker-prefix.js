"use strict";

function commentMarkerPrefix(repository) {
  const name = repository.toLowerCase();
  return name === "fullstack-template" ? "fullstacktemplate" : name;
}

module.exports = { commentMarkerPrefix };
