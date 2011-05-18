/*
 * Testing the output of when routes are exectued. 
 */

describe("routing", function() {
  var r;
  beforeEach(function() {
    r = new routes();
  });

  it("should fire on push state", function() {

  });

  it("should fire on form submision", function() {
    var triggered = false;
    r.post("/test", function() {
      triggered = true;
    });
    var form = document.createElement("form");
    var submit = document.createElement("input");
    submit.type = "submit";
    form.action = "/test";
    form.method = "post";
    form.appendChild(submit);
     
    window.document.body.appendChild(form);
    
    submit.click();

    window.document.body.removeChild(form);

    expect(triggered).toEqual(true);
  }); 

});
