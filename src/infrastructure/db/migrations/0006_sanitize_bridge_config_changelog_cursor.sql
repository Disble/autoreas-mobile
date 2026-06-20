UPDATE `bridge_config` SET `last_changelog_id` = 0 WHERE `last_changelog_id` > 1000000000000 OR `last_changelog_id` < 0;
