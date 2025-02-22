const express = require('express')
const router = express.Router()
const Joi = require('joi')

const { sql, VIDEO_ORDER_ASC } = require('../../db')
const { formatDate } = require('../../helper')
const { generateStarName } = require('../../generate')

const handler = require('../../middleware/handlers')
const schemaHandler = require('../../middleware/schema')

router.get(
	'/',
	handler(async db => await db.query(sql(`ageInVideo ${VIDEO_ORDER_ASC ? 'ASC' : 'DESC'}, stars.id`, 500), { id: 0 }))
)

router.put(
	'/:id',
	handler(async (db, { id }, body) => {
		const value = schemaHandler(
			Joi.object({
				title: Joi.string(),
				starAge: Joi.number().integer().min(18).max(99).allow('', 0),
				plays: Joi.number().integer().min(0)
			}).xor('title', 'starAge', 'plays'),
			body
		)

		if ('title' in value) {
			await db.query('UPDATE videos SET name = :title WHERE id = :videoID', { title: value.title, videoID: id })
		} else if ('starAge' in value) {
			if (!value.starAge) {
				await db.query('UPDATE videos SET starAge = NULL WHERE id = :videoID', { videoID: id })
			} else {
				await db.query('UPDATE videos SET starAge = :age WHERE id = :videoID', {
					age: value.starAge,
					videoID: id
				})
			}
		} else if ('plays' in value) {
			if (!value.plays) {
				// Reset PLAYS
				await db.query('DELETE FROM plays WHERE videoID = :videoID', { videoID: id })
			} else {
				// Add PLAY
				await db.query('INSERT INTO plays(videoID) VALUES(:videoID)', { videoID: id })
			}
		}
	})
)

router.post(
	'/:id/attribute',
	handler(async (db, { id }, body) => {
		const { attributeID } = schemaHandler(
			Joi.object({
				attributeID: Joi.number().integer().required()
			}),
			body
		)

		const result = await db.query(
			'SELECT COUNT(*) as total FROM videoattributes WHERE videoID = :videoID AND attributeID = :attributeID',
			{
				videoID: id,
				attributeID
			}
		)
		if (!result[0].total) {
			const insert = await db.query(
				'INSERT INTO videoattributes(videoID, attributeID) VALUES(:videoID, :attributeID)',
				{
					videoID: id,
					attributeID
				}
			)

			return { id: insert.insertId, videoID: id, attributeID }
		} else {
			throw new Error('Attribute already exists')
		}
	})
)

router.post(
	'/:id/location',
	handler(async (db, { id }, body) => {
		const { locationID } = schemaHandler(
			Joi.object({
				locationID: Joi.number().integer().required()
			}),
			body
		)

		const result = await db.query(
			'SELECT COUNT(*) as total FROM videolocations WHERE videoID = :videoID AND locationID = :locationID',
			{
				videoID: id,
				locationID
			}
		)
		if (!result[0].total) {
			const insert = await db.query(
				'INSERT INTO videolocations(videoID, locationID) VALUES(:videoID, :locationID)',
				{
					videoID: id,
					locationID
				}
			)

			return { id: insert.insertId, videoID: id, locationID }
		} else {
			throw new Error('Location already exists')
		}
	})
)

router.post(
	'/:id/bookmark',
	handler(async (db, { id }, body) => {
		const { categoryID, time } = schemaHandler(
			Joi.object({
				categoryID: Joi.number().integer().min(1).required(),
				time: Joi.number().integer().min(1).required()
			}),
			body
		)

		const bookmark = await db.query(
			'SELECT COUNT(*) as total FROM bookmarks WHERE videoID = :videoID AND start = :time LIMIT 1',
			{
				videoID: id,
				time
			}
		)
		if (!bookmark[0].total) {
			const insert = await db.query(
				'INSERT INTO bookmarks(videoID, categoryID, start) VALUES(:videoID, :categoryID, :time)',
				{
					videoID: id,
					categoryID,
					time
				}
			)

			return { id: insert.insertId, videoID: id, categoryID, time, starID: 0 }
		} else {
			throw new Error('Bookmark already exists')
		}
	})
)

router.delete(
	'/:id/bookmark',
	handler(async (db, { id }) => {
		await db.query('DELETE FROM bookmarks WHERE videoID = :videoID', { videoID: id })
	})
)

router.get(
	'/:id',
	handler(async (db, { id }) => {
		const data = await db.query('SELECT * FROM videos WHERE id = :videoID LIMIT 1', { videoID: id })
		const video = data[0]

		// Ignore StarAge
		delete video.starAge

		video.star = generateStarName(video.path)

		// Format Date
		const date_added = formatDate(video.added)
		const date_published = formatDate(video.date)

		// change 'date(s)' to object
		video.date = {
			added: date_added,
			published: date_published
		}
		delete video.date_published
		delete video.added

		// change 'path(s)' to object
		video.path = {
			file: video.path,
			stream: `${video.path.split('.').slice(0, -1).join('.')}/playlist.m3u8`
		}

		const result = await db.query('SELECT COUNT(*) as plays FROM plays WHERE videoID = :videoID', { videoID: id })
		video.plays = result[0].plays

		video.locations = await db.query(
			'SELECT locations.name, videolocations.id FROM videolocations JOIN locations ON videolocations.locationID = locations.id WHERE videoID = :videoID',
			{ videoID: id }
		)

		video.attributes = await db.query(
			'SELECT attributes.name, videoattributes.id FROM videoattributes JOIN attributes ON videoattributes.attributeID = attributes.id WHERE videoID = :videoID',
			{ videoID: id }
		)

		const website = await db.query(
			'SELECT name FROM videowebsites JOIN websites ON videowebsites.websiteID = websites.id WHERE videoID = :videoID LIMIT 1',
			{ videoID: id }
		)
		video.website = website[0].name

		const site = await db.query(
			'SELECT name FROM videosites JOIN sites ON videosites.siteID = sites.id WHERE videoID = :videoID LIMIT 1',
			{ videoID: id }
		)
		video.subsite = site[0] ? site[0].name : null

		// Get NextID
		let nextIDs = null
		if (VIDEO_ORDER_ASC) {
			nextIDs = await db.query(sql('ageInVideo, stars.id'), { id })
		} else {
			nextIDs = await db.query(sql('ageInVideo DESC, stars.id'), { id })
		}
		let match = false
		nextIDs.forEach(item => {
			if (!match) {
				if (item.id == id) match = true
			} else if (!video.nextID) {
				video.nextID = item.id
			}
		})

		return video
	})
)

router.get(
	'/:id/star',
	handler(async (db, { id }) => {
		const stars = await db.query(
			'SELECT stars.id, stars.name, stars.image, COALESCE(starAge * 365, DATEDIFF(videos.date, stars.birthdate)) AS ageInVideo FROM stars JOIN videostars ON stars.id = videostars.starID JOIN videos ON videostars.videoID = videos.id WHERE videostars.videoID = :videoID LIMIT 1',
			{ videoID: id }
		)

		if (stars[0]) {
			const star = stars[0]

			const result = await db.query('SELECT COUNT(*) AS total FROM videostars WHERE starID = :starID', {
				starID: star.id
			})
			star.numVideos = result[0].total

			return star
		} else {
			throw new Error('Video does not have any star')
		}
	})
)

router.post(
	'/:id/star',
	handler(async (db, { id }, body) => {
		const { name } = schemaHandler(
			Joi.object({
				name: Joi.string().min(2).required()
			}),
			body
		)

		// Get StarID
		var stars = await db.query('SELECT id, image FROM stars WHERE name = :star', { star: name })
		if (!stars[0]) {
			// Create New STAR
			await db.query('INSERT INTO stars(name) VALUES(:star)', { star: name })

			// Get StarID
			var stars = await db.query('SELECT id, image FROM stars WHERE name = :star LIMIT 1', { star: name })
		}

		const starID = stars[0].id
		// Check if VIDEOSTAR Exists for current VIDEO
		const result = await db.query(
			'SELECT COUNT(*) as total FROM videostars WHERE starID = :starID AND videoID = :videoID LIMIT 1',
			{
				starID,
				videoID: id
			}
		)
		if (!result[0].total) {
			// Insert VIDEOSTAR into table
			await db.query('INSERT INTO videostars(starID, videoID) VALUES(:starID, :videoID)', {
				videoID: id,
				starID
			})

			const stars = await db.query(
				'SELECT stars.id, stars.name, stars.image, COALESCE(starAge * 365, DATEDIFF(videos.date, stars.birthdate)) AS ageInVideo FROM stars JOIN videostars ON stars.id = videostars.starID JOIN videos ON videostars.videoID = videos.id WHERE videostars.videoID = :videoID LIMIT 1',
				{ videoID: id }
			)
			if (stars[0]) {
				const star = stars[0]

				const result = await db.query('SELECT COUNT(*) AS total FROM videostars WHERE starID = :starID', {
					starID: star.id
				})
				star.numVideos = result[0].total

				return star
			} else {
				throw new Error('Could not read StarData from database')
			}
		} else {
			throw new Error('Star already exists')
		}
	})
)

router.delete(
	'/:id/star/:starID',
	handler(async (db, { id, starID }) => {
		await db.query('DELETE FROM videostars WHERE videoID = :videoID AND starID = :starID', {
			videoID: id,
			starID
		})
	})
)

router.get(
	'/:id/bookmark',
	handler(
		async (db, { id }) =>
			await db.query(
				'SELECT bookmarks.id, categories.name, bookmarks.start FROM bookmarks JOIN categories ON bookmarks.categoryID = categories.id WHERE videoID = :videoID ORDER BY start',
				{ videoID: id }
			)
	)
)

module.exports = router
