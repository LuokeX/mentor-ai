import { createCaptcha } from '../../../domain/cend-captcha'

export default defineEventHandler(event => createCaptcha(event))
