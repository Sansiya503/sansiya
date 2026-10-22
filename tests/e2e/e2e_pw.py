import sys
from playwright.sync_api import sync_playwright
BASE = "http://localhost:8768/"
LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js"
MOCK = r"""
(function(){
  const UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  window.__calls = [];
  const q = () => { const api = { select(){return api}, order(){return api}, range(){return api}, eq(){return api}, maybeSingle(){return api}, upsert(){return api}, delete(){return api}, then(res){ return Promise.resolve({data:[], error:null}).then(res); } }; return api; };
  window.supabase = { createClient(url, key, opts){
    window.__opts = opts;
    let cb = null;
    return { auth: {
      async getSession(){ const recovery = /type=recovery/.test(location.hash); const s = sessionStorage.getItem("mocksession") || (recovery ? JSON.stringify({user:{id:UID,email:"me@test.com"}}) : null); if(recovery && cb) setTimeout(()=>cb("PASSWORD_RECOVERY", JSON.parse(s)), 0); return {data:{session: s ? JSON.parse(s) : null}}; },
      async signInWithPassword(){ return {data:{}, error:{message:"Invalid login credentials"}}; },
      async resetPasswordForEmail(email, o){ window.__calls.push(["reset", email, o && o.redirectTo]); return {error:null}; },
      async updateUser(u){ window.__calls.push(["update", u.password.length]); return {data:{user:{id:UID,email:"me@test.com"}}, error:null}; },
      async signOut(){ return {error:null}; },
      onAuthStateChange(f){ cb = f; return {data:{subscription:{unsubscribe(){}}}}; }
    }, from: q, storage: { from(){ return { async createSignedUrls(p){ return {data:[], error:null}; } }; } } };
  } };
})();
"""
log=[]
def ok(n,c,x=""): log.append(("PASS" if c else "FAIL")+f"  {n} {x}")
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width":412,"height":915}, service_workers="block")
    ctx.route(LIB, lambda r: r.fulfill(status=200, content_type="application/javascript", body=MOCK))
    ctx.add_init_script("""localStorage.setItem('sansiya-config', JSON.stringify({supabaseUrl:'https://abcd.supabase.co', supabaseKey:'sb_publishable_test_key_123456789'}))""")
    pg = ctx.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    # config.js in repo already has real values; override with route so the test never touches the real project
    ctx.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body="window.SANSIYA_CONFIG={supabaseUrl:'https://abcd.supabase.co',supabaseKey:'sb_publishable_test_key_123456789'};"))
    pg.goto(BASE); pg.wait_for_selector("#gateForm[data-kind=login]")
    ok("detectSessionInUrl on", pg.evaluate("window.__opts.auth.detectSessionInUrl === true"))
    pg.fill("#g-pw", "abc123"); pg.check("[data-showpw=g-pw]")
    ok("show password toggles type", pg.get_attribute("#g-pw","type") == "text")
    pg.fill("#g-email", "me@test.com"); pg.click("#g-submit"); pg.wait_for_selector(".gate-card .err")
    ok("wrong password hint", "한글" in pg.inner_text(".gate-card .err"))
    pg.click("[data-gate=forgot]"); pg.wait_for_selector(".gate-card .note")
    calls = pg.evaluate("window.__calls")
    ok("reset mail requested with redirect", calls and calls[0][0]=="reset" and calls[0][2]=="http://localhost:8768/", str(calls))
    ok("email kept after notice", pg.input_value("#g-email")=="me@test.com")
    pg.screenshot(path=sys.argv[1]+"/pw-login.png")
    # empty email
    pg.fill("#g-email",""); pg.click("[data-gate=forgot]"); pg.wait_for_timeout(200)
    ok("empty email asks for email", "이메일" in pg.inner_text(".gate-card .err"))
    # recovery link
    pg.goto("about:blank"); pg.goto(BASE + "#access_token=x&refresh_token=y&type=recovery"); pg.wait_for_selector("#gateForm[data-kind=recover]")
    ok("recovery screen shown", True)
    ok("hash cleaned", "#" not in pg.url, pg.url)
    pg.fill("#g-new","short"); pg.fill("#g-new2","short"); pg.click("#g-submit"); pg.wait_for_selector(".gate-card .err")
    ok("min length check", "6자" in pg.inner_text(".gate-card .err"))
    pg.fill("#g-new","newpass1"); pg.fill("#g-new2","newpass2"); pg.click("#g-submit"); pg.wait_for_timeout(200)
    ok("mismatch check", "서로 달라요" in pg.inner_text(".gate-card .err"))
    pg.screenshot(path=sys.argv[1]+"/pw-recover.png")
    pg.fill("#g-new","newpass1"); pg.fill("#g-new2","newpass1"); pg.click("#g-submit")
    pg.wait_for_selector("#app:not([hidden])")
    ok("enters app after new password", pg.evaluate("window.__calls.some(c=>c[0]=='update')"))
    # change password from settings
    pg.click("#setBtn"); pg.click("[data-act=changePw]"); pg.wait_for_selector("#gateForm[data-kind=recover]")
    ok("settings change-pw screen has cancel", pg.locator("[data-gate=cancelPw]").count()==1)
    pg.click("[data-gate=cancelPw]"); pg.wait_for_selector("#app:not([hidden])")
    ok("cancel returns to app", True)
    # expired link
    pg.evaluate("sessionStorage.clear()")
    pg.goto("about:blank"); pg.goto(BASE + "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")
    pg.wait_for_selector("#gateForm[data-kind=login]")
    ok("expired link message", "만료" in pg.inner_text(".gate-card .err"))
    b.close()
for l in log: print(l)
print("errors:", errs or "none")
